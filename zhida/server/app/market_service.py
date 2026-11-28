"""技能市场：匹配复用普遍技能包；个人规划不入库。"""

from __future__ import annotations

import json
import re

from sqlalchemy import func
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


MARKET_STATUS_LABEL = {
    "pending": "待上线",
    "active": "已上线",
    "offline": "已下线",
}


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
    status = (item.status or "active").strip().lower()
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
        "source": item.source or "",
        "status": status,
        "status_label": MARKET_STATUS_LABEL.get(status, status),
        "created_at": item.created_at.isoformat() if item.created_at else "",
        "updated_at": item.updated_at.isoformat() if item.updated_at else "",
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
    from .workflows.plan_graph import strip_duration_from_title

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
    # 顺带清洗市场里历史「xx入门30天」标题（随本次草案事务提交）
    if best is not None:
        cleaned_title = strip_duration_from_title(best.title or "") or best.title
        cleaned_name = strip_duration_from_title(best.skill_name or "") or best.skill_name
        if cleaned_title and cleaned_title != best.title:
            best.title = cleaned_title[:128]
        if cleaned_name and cleaned_name != best.skill_name:
            best.skill_name = cleaned_name[:64]
    return best


_DIFF_DAY_MULT = {"easy": 0.7, "medium": 1.0, "hard": 1.4}
# LLM 常把课时报高；按难度封顶，缺省给合理课时
_DIFF_DEFAULT_HOURS = {"easy": 3.5, "medium": 7.0, "hard": 12.0}
_DIFF_HOUR_CAP = {"easy": 6.0, "medium": 12.0, "hard": 20.0}


def estimate_module_days(modules: list | None, *, daily_minutes: int = 60) -> int:
    """按模块难度、封顶后的课时与每日可用时长估算学习天数（不含起日当天）。

    以课时为主、技能点为辅，避免 LLM 一律 30 天或虚高 estimated_hours。
    """
    import math

    mods = [m for m in (modules or []) if isinstance(m, dict)]
    if not mods:
        return 14
    weighted_skills = 0.0
    hours = 0.0
    for m in mods:
        diff = str(m.get("difficulty") or "medium").lower()
        if diff not in _DIFF_DEFAULT_HOURS:
            diff = "medium"
        mult = _DIFF_DAY_MULT.get(diff, 1.0)
        skills = m.get("skills") or []
        n = max(1, len(skills) if isinstance(skills, list) else 1)
        weighted_skills += n * mult
        try:
            raw_h = float(m.get("estimated_hours") or 0)
        except (TypeError, ValueError):
            raw_h = 0.0
        if raw_h <= 0:
            raw_h = _DIFF_DEFAULT_HOURS[diff]
        else:
            raw_h = min(raw_h, _DIFF_HOUR_CAP[diff])
        hours += raw_h
    daily = max(15, int(daily_minutes or 60))
    by_hours = max(1, int(math.ceil((hours * 60.0) / daily)))
    # 技能点辅助：入门偏少、较难偏多，但不压过课时估算太多
    by_skills = max(len(mods) * 2, int(math.ceil(weighted_skills * 1.15)))
    days = max(by_hours, by_skills)
    # 纯入门短链路可到 5 天；上限 75，杜绝默认 30/90
    return max(5, min(75, days))


def market_item_to_plan_data(item: SkillMarketItem, *, raw_text: str, baseline: str, daily_minutes: int) -> dict:
    """把市场技能包转成与 LLM 草案同构的 data。"""
    from .workflows.fallback import add_days, today_str
    from .workflows.plan_graph import parse_user_duration_days, strip_duration_from_title

    detail = serialize_market_item(item, detail=True)
    modules = detail.get("modules") or []
    start = today_str()
    user_days = parse_user_duration_days(raw_text)
    if user_days is not None and user_days > 0:
        days = user_days
    else:
        days = estimate_module_days(modules, daily_minutes=daily_minutes)
    # 市场旧包常带「xx入门30天」；用户没写天数时标题去掉天数
    raw_title = (item.title or item.skill_name or "学习目标").strip()
    title = (
        strip_duration_from_title(raw_title) if not (user_days and user_days > 0) else raw_title
    ) or raw_title
    return {
        "goal": {
            "title": title[:16],
            "description": raw_text or item.skill_overview or "",
            "goal_type": normalize_domain(item.domain),
            "baseline": baseline or "未说明",
            "daily_minutes": daily_minutes,
            "start_date": start,
            "deadline": add_days(start, days),
            "completion_criteria": f"完成「{strip_duration_from_title(item.skill_name or title) or title}」各阶段可检验练习",
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
    from .workflows.plan_graph import strip_duration_from_title

    skill_name = (
        (data.get("market_skill_name") or "").strip()
        or ((data.get("goal") or {}).get("title") or "").strip()
        or "未命名技能"
    )
    skill_name = (strip_duration_from_title(skill_name) or skill_name)[:64]
    title = ((data.get("goal") or {}).get("title") or skill_name).strip()
    title = (strip_duration_from_title(title) or title)[:128]
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
        # 已有市场包：只补空字段，不覆盖已验证内容；顺带清掉标题里的假「N天」
        cleaned_title = strip_duration_from_title(existing.title or "") or existing.title
        cleaned_name = strip_duration_from_title(existing.skill_name or "") or existing.skill_name
        if cleaned_title and cleaned_title != existing.title:
            existing.title = cleaned_title[:128]
        if cleaned_name and cleaned_name != existing.skill_name:
            existing.skill_name = cleaned_name[:64]
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
        # LLM 新技能默认待上线，需运营在 Ops 后台审核后上线
        status="pending",
    )
    db.add(item)
    db.flush()
    return item


def list_market_items_admin(
    db: Session,
    *,
    status: str | None = None,
    q: str = "",
    domain: str | None = None,
    limit: int = 100,
) -> list[SkillMarketItem]:
    """运营后台：可按状态筛选，含 pending / offline。"""
    query = db.query(SkillMarketItem)
    st = (status or "").strip().lower()
    if st in ("pending", "active", "offline"):
        query = query.filter(SkillMarketItem.status == st)
    items = query.order_by(SkillMarketItem.updated_at.desc(), SkillMarketItem.id.desc()).all()
    want = normalize_domain(domain) if domain and domain not in ("", "all") else ""
    if want:
        items = [it for it in items if normalize_domain(it.domain) == want]
    needle = _norm(q)
    if needle:
        scored = []
        for it in items:
            score = _match_score(it, needle, q)
            if score > 0 or needle in _norm(it.skill_name) or needle in _norm(it.title):
                scored.append((score, it))
        scored.sort(key=lambda x: (-x[0], -int(x[1].use_count or 0)))
        items = [it for _, it in scored]
    return items[: max(1, min(limit, 200))]


def set_market_item_status(
    db: Session, item_id: int, status: str
) -> SkillMarketItem:
    st = (status or "").strip().lower()
    if st not in ("pending", "active", "offline"):
        raise ValueError("status 仅支持 pending / active / offline")
    item = db.get(SkillMarketItem, item_id)
    if not item:
        raise ValueError("技能不存在")
    item.status = st
    item.updated_at = utc_now()
    db.flush()
    return item


def market_status_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(SkillMarketItem.status, func.count(SkillMarketItem.id))
        .group_by(SkillMarketItem.status)
        .all()
    )
    out = {"pending": 0, "active": 0, "offline": 0, "total": 0}
    for st, n in rows:
        key = (st or "").strip().lower() or "active"
        if key not in out:
            out[key] = 0
        out[key] = int(n or 0)
        out["total"] += int(n or 0)
    return out


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
