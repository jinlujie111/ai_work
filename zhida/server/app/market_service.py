"""技能市场：匹配复用普遍技能包；个人规划不入库。"""

from __future__ import annotations

import json
import re
from sqlalchemy.orm import Session

from .models import SkillMarketItem
from .resources_catalog import infer_goal_type
from .timeutil import utc_now

# 市场分类：key 存库，label 展示。筛选按 key。
MARKET_CATEGORIES: list[dict[str, str]] = [
    {"key": "python", "label": "编程"},
    {"key": "ai", "label": "AI"},
    {"key": "english", "label": "语言"},
    {"key": "office", "label": "办公"},
    {"key": "fitness", "label": "运动"},
    {"key": "generic", "label": "综合"},
]
DOMAIN_LABEL = {c["key"]: c["label"] for c in MARKET_CATEGORIES}
# 兼容旧数据 / 别名 → 规范 key
DOMAIN_ALIASES = {
    "programming": "python",
    "code": "python",
    "coding": "python",
    "lang": "english",
    "language": "english",
    "excel": "office",
    "ppt": "office",
    "word": "office",
    "sport": "fitness",
    "health": "fitness",
    "other": "generic",
    "通用": "generic",
    "综合": "generic",
    "编程": "python",
    "语言": "english",
    "办公": "office",
    "运动": "fitness",
}

_PERSONAL_HINTS = (
    "我的公司",
    "我们公司",
    "本周",
    "下周",
    "述职",
    "答辩",
    "内部",
    "定制",
    "私教",
    "仅限",
    "这次项目",
    "这个项目",
    "帮我准备",
    "加班",
    "领导要求",
    "kpi",
    "okr",
)


def _loads(raw: str | None, default):
    if not raw:
        return default
    try:
        data = json.loads(raw)
        return data if data is not None else default
    except json.JSONDecodeError:
        return default


def _dumps(data) -> str:
    return json.dumps(data, ensure_ascii=False)


def _norm(text: str) -> str:
    s = (text or "").strip().lower()
    s = re.sub(r"[\s\u3000]+", "", s)
    s = re.sub(r"[，。！？、；：,.!?;:\"'`~@#$%^&*()（）【】\[\]{}<>《》/\\|+-]", "", s)
    return s


def _slugify(name: str) -> str:
    base = _norm(name) or "skill"
    base = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", base).strip("-")[:48]
    return base or f"skill-{int(utc_now().timestamp())}"


def normalize_domain(raw: str | None) -> str:
    key = (raw or "").strip().lower() or "generic"
    key = DOMAIN_ALIASES.get(key, key)
    if key not in DOMAIN_LABEL:
        return "generic"
    return key


def domain_label(raw: str | None) -> str:
    return DOMAIN_LABEL.get(normalize_domain(raw), "综合")


def serialize_market_item(item: SkillMarketItem, *, detail: bool = False) -> dict:
    modules_blob = _loads(item.modules_json, {})
    if isinstance(modules_blob, list):
        modules = modules_blob
        overview = item.skill_overview or ""
        scenarios = _loads(item.skill_scenarios_json, [])
        categories = _loads(item.skill_categories_json, [])
    else:
        modules = modules_blob.get("modules") or []
        overview = item.skill_overview or modules_blob.get("skill_overview") or ""
        scenarios = _loads(item.skill_scenarios_json, None) or modules_blob.get("skill_scenarios") or []
        categories = (
            _loads(item.skill_categories_json, None) or modules_blob.get("skill_categories") or []
        )
    domain = normalize_domain(item.domain)
    out = {
        "id": item.id,
        "skill_name": item.skill_name,
        "title": item.title,
        "slug": item.slug,
        "domain": domain,
        "domain_label": domain_label(domain),
        "skill_overview": overview,
        "skill_scenarios": scenarios if isinstance(scenarios, list) else [],
        "skill_categories": categories if isinstance(categories, list) else [],
        "module_count": len(modules) if isinstance(modules, list) else 0,
        "use_count": int(item.use_count or 0),
        "source": item.source,
        "status": item.status,
    }
    if detail:
        out["aliases"] = _loads(item.aliases_json, [])
        out["keywords"] = _loads(item.keywords_json, [])
        out["modules"] = modules if isinstance(modules, list) else []
        out["resources"] = _loads(item.resources_json, [])
        out["learning_path"] = _loads(item.learning_path_json, {})
    return out


def list_market_categories(db: Session) -> list[dict]:
    """返回全部规范分类 + 当前市场上该分类技能数（含 0）。"""
    rows = (
        db.query(SkillMarketItem.domain, SkillMarketItem.id)
        .filter(SkillMarketItem.status == "active")
        .all()
    )
    counts: dict[str, int] = {c["key"]: 0 for c in MARKET_CATEGORIES}
    for domain, _id in rows:
        key = normalize_domain(domain)
        counts[key] = counts.get(key, 0) + 1
    # 只展示有技能的分类 + 固定顺序；综合始终保留便于兜底浏览
    out = []
    for c in MARKET_CATEGORIES:
        n = counts.get(c["key"], 0)
        if n > 0 or c["key"] == "generic":
            out.append({"key": c["key"], "label": c["label"], "count": n})
    return out


def list_market_items(
    db: Session,
    *,
    q: str = "",
    domain: str | None = None,
    limit: int = 50,
) -> list[SkillMarketItem]:
    query = db.query(SkillMarketItem).filter(SkillMarketItem.status == "active")
    items = query.order_by(SkillMarketItem.use_count.desc(), SkillMarketItem.id.desc()).all()
    want = normalize_domain(domain) if domain and domain not in ("", "all") else ""
    if want:
        # 兼容库内旧 key / 别名
        items = [it for it in items if normalize_domain(it.domain) == want]
    needle = _norm(q)
    if not needle:
        return items[:limit]
    scored = []
    for it in items:
        score = _match_score(it, needle, q)
        if score > 0:
            scored.append((score, it))
    scored.sort(key=lambda x: (-x[0], -(x[1].use_count or 0)))
    return [it for _, it in scored[:limit]]


def _match_score(item: SkillMarketItem, needle: str, raw_q: str) -> int:
    if not needle:
        return 0
    title_n = _norm(item.title)
    name_n = _norm(item.skill_name)
    score = 0
    if needle == name_n or needle == title_n:
        score += 100
    if name_n and (name_n in needle or needle in name_n):
        score += 60
    if title_n and (title_n in needle or needle in title_n):
        score += 50
    for a in _loads(item.aliases_json, []):
        an = _norm(str(a))
        if not an:
            continue
        if an == needle:
            score += 90
        elif an in needle or needle in an:
            score += 40
    for k in _loads(item.keywords_json, []):
        kn = _norm(str(k))
        if kn and kn in needle:
            score += 20
    # 原文弱包含
    raw_n = _norm(raw_q)
    if name_n and name_n in raw_n:
        score += 25
    return score


def find_market_match(db: Session, raw_text: str) -> SkillMarketItem | None:
    """生成草案前：技能市场命中则返回最佳项。"""
    q = (raw_text or "").strip()
    if len(q) < 2:
        return None
    needle = _norm(q)
    items = (
        db.query(SkillMarketItem)
        .filter(SkillMarketItem.status == "active")
        .all()
    )
    best: SkillMarketItem | None = None
    best_score = 0
    for it in items:
        score = _match_score(it, needle, q)
        if score > best_score:
            best_score = score
            best = it
    # 阈值：至少命中别名/标题弱匹配
    if best_score < 40:
        return None
    return best


def estimate_module_days(modules: list | None, *, daily_minutes: int = 60) -> int:
    """按模块/技能点与每日可用时长估算学习天数（不含起日当天）。"""
    mods = [m for m in (modules or []) if isinstance(m, dict)]
    if not mods:
        return 21
    skill_n = 0
    hours = 0.0
    for m in mods:
        skills = m.get("skills") or []
        skill_n += max(1, len(skills) if isinstance(skills, list) else 1)
        try:
            hours += float(m.get("estimated_hours") or 0)
        except (TypeError, ValueError):
            pass
    daily = max(10, int(daily_minutes or 60))
    # 每技能点约 1.5 个学习日；或按小时 / 每日时长
    by_skills = max(len(mods) * 4, int(skill_n * 1.5) + len(mods))
    by_hours = int((hours * 60) / daily) + len(mods) if hours > 0 else 0
    return max(7, min(90, max(by_skills, by_hours, 14)))


def market_item_to_plan_data(item: SkillMarketItem, *, raw_text: str, baseline: str, daily_minutes: int) -> dict:
    """把市场技能包转成与 LLM 草案同构的 data。"""
    from .workflows.fallback import add_days, today_str

    detail = serialize_market_item(item, detail=True)
    modules = detail.get("modules") or []
    start = today_str()
    days = estimate_module_days(modules, daily_minutes=daily_minutes)
    return {
        "goal": {
            "title": item.title[:16],
            "description": item.skill_overview or raw_text,
            "goal_type": normalize_domain(item.domain),
            "baseline": baseline or "未说明",
            "daily_minutes": daily_minutes,
            "start_date": start,
            "deadline": add_days(start, days),
            "completion_criteria": f"完成「{item.skill_name}」各阶段可检验练习",
        },
        "skill_overview": detail.get("skill_overview") or "",
        "skill_scenarios": detail.get("skill_scenarios") or [],
        "skill_categories": detail.get("skill_categories") or ["综合"],
        "modules": modules,
        "recommended_resources": detail.get("resources") or [],
        "learning_path": detail.get("learning_path") or {},
        "analysis": {
            "reason": f"命中技能市场：{item.skill_name}",
            "warnings": [],
            "source": "market",
            "market_id": item.id,
            "market_skill_name": item.skill_name,
        },
    }


def looks_personal(raw_text: str, data: dict | None = None) -> bool:
    text = (raw_text or "").lower()
    if any(h.lower() in text for h in _PERSONAL_HINTS):
        return True
    if data and data.get("marketable") is False:
        return True
    return False


def should_publish_to_market(raw_text: str, data: dict) -> bool:
    """仅普遍技能进市场；个人规划不进。

    LLM 成功后：marketable=true 或未标注时默认入库；
    marketable=false 或命中个人线索时不入库。
    """
    if looks_personal(raw_text, data):
        return False
    if data.get("marketable") is False:
        return False
    if data.get("marketable") is True:
        return True
    # 未标注：只要不是个人规划，默认视为可入库的普遍技能
    name = (data.get("market_skill_name") or (data.get("goal") or {}).get("title") or "").strip()
    return bool(name)


def upsert_market_from_plan(
    db: Session,
    *,
    raw_text: str,
    data: dict,
    resources: list | None = None,
    learning_path: dict | None = None,
) -> SkillMarketItem | None:
    if not should_publish_to_market(raw_text, data):
        return None
    skill_name = (
        (data.get("market_skill_name") or "").strip()
        or ((data.get("goal") or {}).get("title") or "").strip()
        or "未命名技能"
    )[:64]
    title = ((data.get("goal") or {}).get("title") or skill_name)[:128]
    domain = normalize_domain(
        infer_goal_type(raw_text, ((data.get("goal") or {}).get("goal_type") or "generic"))
    )
    slug = _slugify(skill_name)

    existing = (
        db.query(SkillMarketItem)
        .filter(SkillMarketItem.slug == slug)
        .first()
    )
    modules = data.get("modules") or []
    modules_blob = {
        "skill_categories": data.get("skill_categories") or [],
        "skill_overview": data.get("skill_overview") or "",
        "skill_scenarios": data.get("skill_scenarios") or [],
        "modules": modules,
    }
    aliases = list({skill_name, title, *((data.get("aliases") or []) if isinstance(data.get("aliases"), list) else [])})
    # 从原文抽几个短词作关键词
    keywords = [skill_name, title, domain]
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,12}", raw_text or ""):
        if token not in keywords:
            keywords.append(token)
        if len(keywords) >= 12:
            break

    if existing:
        # 已有市场包：只补空字段，不覆盖已验证内容
        if not existing.skill_overview and data.get("skill_overview"):
            existing.skill_overview = data.get("skill_overview") or ""
        if not _loads(existing.modules_json, {}).get("modules") and modules:
            existing.modules_json = _dumps(modules_blob)
        existing.updated_at = utc_now()
        return existing

    item = SkillMarketItem(
        skill_name=skill_name,
        title=title,
        slug=slug,
        domain=domain,
        aliases_json=_dumps(aliases[:8]),
        keywords_json=_dumps(keywords[:12]),
        skill_overview=(data.get("skill_overview") or "")[:2000],
        skill_scenarios_json=_dumps(data.get("skill_scenarios") or []),
        skill_categories_json=_dumps(data.get("skill_categories") or []),
        modules_json=_dumps(modules_blob),
        resources_json=_dumps(resources or data.get("recommended_resources") or []),
        learning_path_json=_dumps(learning_path or data.get("learning_path") or {}),
        scope="universal",
        source="llm",
        use_count=0,
        status="active",
    )
    db.add(item)
    db.flush()
    return item


def bump_use_count(db: Session, item: SkillMarketItem) -> None:
    item.use_count = int(item.use_count or 0) + 1
    item.updated_at = utc_now()


def normalize_existing_domains(db: Session) -> int:
    """把历史脏 domain（如 Excel→generic）纠正到规范分类。"""
    changed = 0
    for it in db.query(SkillMarketItem).all():
        want = normalize_domain(it.domain)
        # 种子 Excel 曾误标 generic
        name_n = _norm(it.skill_name or "") + _norm(it.title or "") + _norm(it.slug or "")
        if "excel" in name_n or "透视表" in (it.skill_overview or ""):
            want = "office"
        if it.domain != want:
            it.domain = want
            changed += 1
    if changed:
        db.commit()
    return changed


def seed_market_if_empty(db: Session) -> int:
    count = db.query(SkillMarketItem).count()
    if count:
        return 0
    seeds = _seed_payloads()
    for s in seeds:
        item = SkillMarketItem(
            skill_name=s["skill_name"],
            title=s["title"],
            slug=s["slug"],
            domain=s["domain"],
            aliases_json=_dumps(s.get("aliases") or []),
            keywords_json=_dumps(s.get("keywords") or []),
            skill_overview=s.get("skill_overview") or "",
            skill_scenarios_json=_dumps(s.get("skill_scenarios") or []),
            skill_categories_json=_dumps(s.get("skill_categories") or []),
            modules_json=_dumps(
                {
                    "skill_categories": s.get("skill_categories") or [],
                    "skill_overview": s.get("skill_overview") or "",
                    "skill_scenarios": s.get("skill_scenarios") or [],
                    "modules": s.get("modules") or [],
                }
            ),
            resources_json=_dumps(s.get("resources") or []),
            learning_path_json=_dumps(s.get("learning_path") or {}),
            scope="universal",
            source="seed",
            use_count=0,
            status="active",
        )
        db.add(item)
    db.commit()
    return len(seeds)


def _seed_payloads() -> list[dict]:
    return [
        {
            "skill_name": "Python入门",
            "title": "Python 入门",
            "slug": "python-intro",
            "domain": "python",
            "aliases": ["学python", "python基础", "python入门", "学会python"],
            "keywords": ["python", "编程", "脚本", "语法"],
            "skill_overview": "掌握 Python 基础语法与常用标准库，能独立写小脚本处理数据和文件。",
            "skill_scenarios": ["写自动化小脚本", "做简单数据分析", "面试/作品展示基础题"],
            "skill_categories": ["编程"],
            "modules": [
                {
                    "key": "m1",
                    "name": "语法与环境",
                    "category": "编程",
                    "skills": ["安装环境", "变量与类型", "控制流"],
                    "learn": "搭好环境，写循环与条件，完成 3 个小练习。",
                    "difficulty": "easy",
                    "estimated_hours": 6,
                    "skippable": False,
                    "materials": [
                        {"title": "官方 Tutorial", "type": "doc", "url": "https://docs.python.org/zh-cn/3/tutorial/", "note": "按章节过基础"}
                    ],
                },
                {
                    "key": "m2",
                    "name": "函数与模块",
                    "category": "编程",
                    "skills": ["函数", "模块", "文件读写"],
                    "learn": "把练习封装成函数，读写文本/CSV。",
                    "difficulty": "medium",
                    "estimated_hours": 8,
                    "skippable": False,
                    "materials": [
                        {"title": "Real Python 入门", "type": "doc", "url": "https://realpython.com/", "note": "查函数与模块示例"}
                    ],
                },
                {
                    "key": "m3",
                    "name": "小项目交付",
                    "category": "编程",
                    "skills": ["脚本项目", "调试", "结果输出"],
                    "learn": "完成一个可运行小项目并保存结果。",
                    "difficulty": "medium",
                    "estimated_hours": 10,
                    "skippable": False,
                    "materials": [
                        {"title": "项目练习清单", "type": "practice", "url": "", "note": "自选一个数据处理脚本"}
                    ],
                },
            ],
            "resources": [
                {"title": "官方 Tutorial", "type": "doc", "url": "https://docs.python.org/zh-cn/3/tutorial/", "note": "主线"}
            ],
            "learning_path": {"label": "Python 入门", "summary": "语法→函数→小项目"},
        },
        {
            "skill_name": "英语听力提升",
            "title": "英语听力提升",
            "slug": "english-listening",
            "domain": "english",
            "aliases": ["练听力", "英语听力", "提升听力", "听力训练"],
            "keywords": ["英语", "听力", "listening", "口语输入"],
            "skill_overview": "通过精听与跟读，提升日常与职场英语听力理解速度与准确度。",
            "skill_scenarios": ["听懂会议要点", "看英文教程", "考试听力提分"],
            "skill_categories": ["语言"],
            "modules": [
                {
                    "key": "m1",
                    "name": "精听习惯",
                    "category": "语言",
                    "skills": ["影子跟读", "逐句精听"],
                    "learn": "每天精听短音频并跟读，记录生词。",
                    "difficulty": "easy",
                    "estimated_hours": 6,
                    "skippable": False,
                    "materials": [
                        {"title": "VOA Learning English", "type": "audio", "url": "https://learningenglish.voanews.com/", "note": "选慢速新闻"}
                    ],
                },
                {
                    "key": "m2",
                    "name": "场景听力",
                    "category": "语言",
                    "skills": ["会议听力", "教程听力"],
                    "learn": "练职场/学习场景听力，做要点笔记。",
                    "difficulty": "medium",
                    "estimated_hours": 8,
                    "skippable": False,
                    "materials": [
                        {"title": "BBC Learning English", "type": "audio", "url": "https://www.bbc.co.uk/learningenglish", "note": "场景对话"}
                    ],
                },
                {
                    "key": "m3",
                    "name": "输出检验",
                    "category": "语言",
                    "skills": ["复述", "摘要"],
                    "learn": "听后口头/书面复述，检验理解。",
                    "difficulty": "medium",
                    "estimated_hours": 6,
                    "skippable": False,
                    "materials": [
                        {"title": "复述练习表", "type": "practice", "url": "", "note": "每篇3点摘要"}
                    ],
                },
            ],
            "resources": [],
            "learning_path": {"label": "英语听力", "summary": "精听→场景→复述"},
        },
        {
            "skill_name": "Excel基础",
            "title": "Excel 基础",
            "slug": "excel-basics",
            "domain": "office",
            "aliases": ["学excel", "excel入门", "表格技能", "电子表格"],
            "keywords": ["excel", "表格", "公式", "透视表"],
            "skill_overview": "掌握常用公式、筛选与透视表，能独立完成日常数据整理与统计。",
            "skill_scenarios": ["周报数据整理", "销售统计", "简单分析看板"],
            "skill_categories": ["办公"],
            "modules": [
                {
                    "key": "m1",
                    "name": "表格与公式",
                    "category": "办公",
                    "skills": ["引用", "常用函数"],
                    "learn": "学会 SUM/IF/VLOOKUP 等基础公式。",
                    "difficulty": "easy",
                    "estimated_hours": 5,
                    "skippable": False,
                    "materials": [
                        {"title": "Microsoft Excel 帮助", "type": "doc", "url": "https://support.microsoft.com/excel", "note": "查函数"}
                    ],
                },
                {
                    "key": "m2",
                    "name": "筛选与透视",
                    "category": "办公",
                    "skills": ["筛选", "透视表"],
                    "learn": "用透视表做分类汇总。",
                    "difficulty": "medium",
                    "estimated_hours": 6,
                    "skippable": False,
                    "materials": [
                        {"title": "透视表演练", "type": "practice", "url": "", "note": "用一份样例表练习"}
                    ],
                },
                {
                    "key": "m3",
                    "name": "报表交付",
                    "category": "办公",
                    "skills": ["图表", "报表规范"],
                    "learn": "输出一份可分享的周报/统计表。",
                    "difficulty": "medium",
                    "estimated_hours": 5,
                    "skippable": False,
                    "materials": [
                        {"title": "报表模板", "type": "doc", "url": "", "note": "固定表头与结论区"}
                    ],
                },
            ],
            "resources": [],
            "learning_path": {"label": "Excel 基础", "summary": "公式→透视→报表"},
        },
    ]
