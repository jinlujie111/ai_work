"""学习地图 + 外部资料指针。

产品定位：小程序不托管课程内容，只回答三件事——
1) 学什么（知识大纲） 2) 用什么框架/工具 3) 资料去哪找（公开链接）
"""

from __future__ import annotations

import re

TYPE_LABEL = {
    "book": "书",
    "course": "课",
    "doc": "文档",
    "video": "视频",
    "practice": "练习",
    "tool": "工具",
    "repo": "仓库",
}

# 出处必须落到具体平台/站点/软件，禁止「学习资料」这类空话
_BAD_ORIGIN = re.compile(
    r"^(学习资料|资料|推荐资料|公开资料|相关资料|参考资料|材料|内容)"
    r"(（|\(|$)|请按查找|按查找方式"
)

_HOST_ORIGIN = {
    "bilibili.com": "B站（bilibili）",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "zhihu.com": "知乎",
    "xiaohongshu.com": "小红书",
    "douyin.com": "抖音",
    "ixigua.com": "西瓜视频",
    "iqiyi.com": "爱奇艺",
    "youku.com": "优酷",
    "tencent.com": "腾讯视频",
    "v.qq.com": "腾讯视频",
    "docs.qq.com": "腾讯文档",
    "docs.google.com": "Google 文档",
    "notion.so": "Notion",
    "feishu.cn": "飞书文档",
    "yuque.com": "语雀",
    "jianshu.com": "简书",
    "csdn.net": "CSDN",
    "juejin.cn": "掘金",
    "github.com": "GitHub",
    "gitee.com": "Gitee",
    "wikipedia.org": "维基百科",
    "baike.baidu.com": "百度百科",
    "zhihuishu.com": "智慧树",
    "icourse163.org": "中国大学MOOC",
    "coursera.org": "Coursera",
    "edx.org": "edX",
    "udemy.com": "Udemy",
    "fast.ai": "fast.ai 官网",
    "pytorch.org": "PyTorch 官网",
    "huggingface.co": "Hugging Face",
    "python.org": "Python 官网",
}


def origin_from_url(url: str) -> str:
    u = (url or "").strip().lower()
    if not u:
        return ""
    for host, name in _HOST_ORIGIN.items():
        if host in u:
            return name
    m = re.search(r"https?://([^/]+)", u)
    if not m:
        return "公开网站"
    host = m.group(1).removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 2:
        return f"{parts[-2].upper()} 网站" if len(parts[-2]) <= 3 else f"{parts[-2]} 网站"
    return "公开网站"


def default_origin_for_type(mat_type: str, *, url: str = "", title: str = "") -> str:
    """按资料类型给出具体平台/软件名，绝不返回「学习资料」。"""
    if url:
        named = origin_from_url(url)
        if named:
            return named
    t = (mat_type or "doc").strip().lower()
    title_l = (title or "").lower()
    if t == "video" or any(k in title_l for k in ("视频", "教程演示", "实操演示")):
        return "B站（bilibili）"
    if t == "course":
        return "中国大学MOOC / B站课程区"
    if t == "book":
        return "微信读书 / 纸质书"
    if t == "repo":
        return "GitHub"
    if t == "tool":
        return "对应官方 App / 官网"
    if t == "practice":
        return "练习表：腾讯文档 / 飞书文档"
    # doc 及默认
    if any(k in title_l for k in ("指南", "手册", "清单", "笔记", "参考表", "文档")):
        return "公开图文：知乎 / 小红书 / 搜索引擎可检索文章"
    return "公开图文网站（知乎 / 百度百科等）"


def normalize_origin(
    origin: str,
    *,
    mat_type: str = "doc",
    url: str = "",
    title: str = "",
) -> str:
    text = (origin or "").strip()
    if text and not _BAD_ORIGIN.search(text) and "学习资料" not in text:
        return text[:120]
    return default_origin_for_type(mat_type, url=url, title=title)[:120]


def default_howto_find(
    *,
    title: str,
    mat_type: str = "doc",
    url: str = "",
    origin: str = "",
) -> str:
    if url:
        return "复制链接，用手机浏览器打开"
    name = (title or "资料名").strip()[:24]
    t = (mat_type or "doc").strip().lower()
    plat = origin or default_origin_for_type(t, title=name)
    if t == "video":
        return f"打开{plat}，搜索「{name}」，选有字幕/完播高的合集"
    if t == "book":
        return f"打开微信读书或购书平台，搜索书名「{name}」"
    if t == "repo":
        return f"打开 GitHub，搜索「{name}」"
    if t == "practice":
        return f"在腾讯文档/飞书新建表格，按「{name}」要点列检查项"
    if t == "course":
        return f"在{plat}搜索课程名「{name}」"
    return f"打开{plat}，搜索「{name}」，对照标题选最近更新的图文"

# ── 学习地图：知识块 + 框架 + 建议顺序 ─────────────────────────────────────
LEARNING_PATHS: dict[str, dict] = {
    "ai": {
        "label": "人工智能 / 大模型应用",
        "summary": "先建立直觉与数学底子，再学框架与工程，最后做小项目闭环。",
        "knowledge": [
            "AI / ML 基本概念（监督/无监督、训练与推理）",
            "Python 数据基础（NumPy / Pandas 够用即可）",
            "神经网络直觉（损失、梯度、过拟合）",
            "Transformer / 大模型基础概念",
            "提示工程与 RAG 应用",
            "微调 / Agent / 评测入门（按目标选）",
        ],
        "frameworks": [
            {"name": "PyTorch", "note": "训练与研究主流框架"},
            {"name": "Hugging Face Transformers", "note": "预训练模型与管线"},
            {"name": "LangChain / LlamaIndex", "note": "应用编排与 RAG（按需）"},
            {"name": "scikit-learn", "note": "经典机器学习快速上手"},
        ],
        "howto": [
            "每天：概念短读 20% + 动手 80%",
            "每周：交一个可运行的小产物（笔记本/脚本/Demo）",
            "资料优先官方文档与课程，少追碎片视频",
        ],
    },
    "python": {
        "label": "Python",
        "summary": "语法 → 常用库 → 小项目，避免只看不写。",
        "knowledge": ["语法与数据结构", "文件/网络/异常", "虚拟环境与包管理", "一个完整小项目"],
        "frameworks": [
            {"name": "标准库", "note": "先吃透再上框架"},
            {"name": "requests / pathlib", "note": "实用脚本高频"},
        ],
        "howto": ["对照官方 Tutorial 敲例子", "每天一个可运行脚本"],
    },
    "english": {
        "label": "英语",
        "summary": "听说读写拆开练，材料难度略高于当前水平。",
        "knowledge": ["高频词汇", "听力精听", "口语跟读", "阅读与输出"],
        "frameworks": [],
        "howto": ["精听 + 跟读固定材料", "用 Anki 巩固词汇"],
    },
    "fitness": {
        "label": "健身",
        "summary": "动作质量优先，再谈容量与强度。",
        "knowledge": ["热身与动作模式", "主项力量", "恢复与睡眠"],
        "frameworks": [],
        "howto": ["先录像自查动作", "记录组数重量"],
    },
    "travel": {
        "label": "旅行规划",
        "summary": "先定目的地与预算，再订交通住宿，最后落每日行程与清单。",
        "knowledge": ["目的地与季节", "预算与签证", "交通住宿", "逐日行程与应急"],
        "frameworks": [],
        "howto": ["先锁定必去点", "预留弹性半天", "重要票据截图备份"],
    },
    "generic": {
        "label": "通用学习",
        "summary": "先定义可检验结果，再选最少资料反复练。",
        "knowledge": ["目标结果定义", "最小技能集", "反馈与复盘"],
        "frameworks": [],
        "howto": ["每周可演示产物", "费曼法自检"],
    },
}

# ── 外部资料目录（只放指针，不托管内容）──────────────────────────────────
CATALOG: dict[str, list[dict]] = {
    "ai": [
        {
            "title": "fast.ai Practical Deep Learning",
            "type": "course",
            "note": "自上而下，快速做出能跑的模型",
            "url": "https://course.fast.ai/",
        },
        {
            "title": "PyTorch 官方 Tutorials",
            "type": "doc",
            "note": "张量、训练循环、迁移学习",
            "url": "https://pytorch.org/tutorials/",
        },
        {
            "title": "Hugging Face Course",
            "type": "course",
            "note": "Transformers / Tokenizers / 分享模型",
            "url": "https://huggingface.co/learn/nlp-course/",
        },
        {
            "title": "DeepLearning.AI / Coursera 吴恩达系列",
            "type": "course",
            "note": "系统建立 ML/DL 概念",
            "url": "https://www.deeplearning.ai/",
        },
        {
            "title": "The Illustrated Transformer",
            "type": "doc",
            "note": "图解注意力机制，建立直觉",
            "url": "https://jalammar.github.io/illustrated-transformer/",
        },
        {
            "title": "OpenAI / Anthropic Prompt 指南",
            "type": "doc",
            "note": "应用向：怎么用好大模型",
            "url": "https://platform.openai.com/docs/guides/prompt-engineering",
        },
        {
            "title": "LangChain 文档（应用编排）",
            "type": "doc",
            "note": "Agent / RAG 入门时再看",
            "url": "https://python.langchain.com/docs/introduction/",
        },
        {
            "title": "Papers With Code",
            "type": "repo",
            "note": "论文 + 可运行实现对照",
            "url": "https://paperswithcode.com/",
        },
    ],
    "python": [
        {
            "title": "官方教程 Python Tutorial",
            "type": "doc",
            "note": "语法与基础概念，适合边做边查",
            "url": "https://docs.python.org/zh-cn/3/tutorial/",
        },
        {
            "title": "廖雪峰 Python 教程",
            "type": "course",
            "note": "中文路径清晰，适合入门到实用",
            "url": "https://www.liaoxuefeng.com/wiki/1016953801520768",
        },
        {
            "title": "Real Python 短文",
            "type": "doc",
            "note": "按主题查实战写法",
            "url": "https://realpython.com/",
        },
        {
            "title": "LeetCode / 练手小脚本",
            "type": "practice",
            "note": "每天写一个小程序巩固",
            "url": "https://leetcode.cn/",
        },
    ],
    "english": [
        {
            "title": "BBC Learning English",
            "type": "course",
            "note": "短视频 + 精听，适合每日训练",
            "url": "https://www.bbc.co.uk/learningenglish",
        },
        {
            "title": "YouGlish",
            "type": "tool",
            "note": "真实语境发音对照",
            "url": "https://youglish.com/",
        },
        {
            "title": "Anki",
            "type": "practice",
            "note": "间隔重复记词汇",
            "url": "https://apps.ankiweb.net/",
        },
    ],
    "fitness": [
        {
            "title": "ExRx 动作库",
            "type": "doc",
            "note": "查动作轨迹与肌肉参与",
            "url": "https://exrx.net/",
        },
        {
            "title": "训练日志（纸质或 App）",
            "type": "tool",
            "note": "记录组数、重量、体感",
            "url": "",
        },
    ],
    "travel": [
        {
            "title": "马蜂窝 / 穷游攻略",
            "type": "doc",
            "note": "目的地亮点与避坑",
            "url": "https://www.mafengwo.cn/",
        },
        {
            "title": "高德 / Google Maps",
            "type": "tool",
            "note": "通勤时间与路线预估",
            "url": "",
        },
        {
            "title": "航空/酒店官方或聚合预订",
            "type": "tool",
            "note": "先比价再下单，保留确认单",
            "url": "",
        },
    ],
    "generic": [
        {
            "title": "目标拆解：先定义可检验结果",
            "type": "doc",
            "note": "每周能演示/交付的小产物",
            "url": "",
        },
        {
            "title": "费曼学习法",
            "type": "practice",
            "note": "讲不清的地方就是下一块",
            "url": "",
        },
    ],
}


def infer_goal_type(raw_text: str, explicit: str = "") -> str:
    """优先从用户原文推断；explicit 仅在非 generic 时采信。"""
    text = (raw_text or "").lower()
    # 注意：中文与 AI 粘连时 \b 会失效，故不用裸 \bai\b
    if re.search(
        r"人工智能|机器学习|深度学习|大模型|大语言模型|"
        r"chatgpt|transformer|神经网络|pytorch|tensorflow|huggingface|"
        r"提示工程|智能体|(?<![a-z0-9])(ai|llm|rag|agent)(?![a-z0-9])",
        text,
        re.I,
    ):
        return "ai"
    if re.search(r"python|数据分析|编程|代码|django|pandas", text, re.I):
        return "python"
    if re.search(r"英语|英文|english|雅思|托福|口语|听力", text, re.I):
        return "english"
    if re.search(r"健身|减脂|增肌|跑步|深蹲|力量|有氧", text, re.I):
        return "fitness"
    if re.search(r"旅行|旅游|出行|行程|攻略|度假|自驾|机票|酒店", text, re.I):
        return "travel"
    if re.search(r"excel|表格|透视表|ppt|powerpoint|word文档|办公软件", text, re.I):
        return "office"
    if explicit and explicit not in ("", "generic"):
        return explicit
    return "generic"


def learning_path_for(goal_type: str, raw_text: str = "") -> dict:
    gt = infer_goal_type(raw_text, goal_type)
    path = LEARNING_PATHS.get(gt) or LEARNING_PATHS["generic"]
    return {
        "domain": gt,
        "label": path["label"],
        "summary": path["summary"],
        "knowledge": list(path.get("knowledge") or []),
        "frameworks": list(path.get("frameworks") or []),
        "howto": list(path.get("howto") or []),
    }


def catalog_for(goal_type: str, raw_text: str = "") -> list[dict]:
    gt = infer_goal_type(raw_text, goal_type)
    items = CATALOG.get(gt) or CATALOG["generic"]
    out = []
    for i, r in enumerate(items):
        note = r.get("note") or ""
        url = r.get("url") or ""
        origin = normalize_origin(
            r.get("origin") or "", mat_type=r["type"], url=url, title=r["title"]
        )
        howto_find = (r.get("howto_find") or "").strip() or default_howto_find(
            title=r["title"], mat_type=r["type"], url=url, origin=origin
        )
        out.append(
            {
                "title": r["title"],
                "type": r["type"],
                "type_label": TYPE_LABEL.get(r["type"], r["type"]),
                "note": note,
                "content": (r.get("content") or note or "")[:1200],
                "url": url,
                "origin": origin[:120],
                "howto_find": howto_find[:240],
                "source": "catalog",
                "sort_order": i,
            }
        )
    return out


def normalize_resources(raw: list | None, *, source: str = "llm") -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for i, r in enumerate(raw[:8]):
        if not isinstance(r, dict):
            continue
        title = (r.get("title") or "").strip()
        if not title:
            continue
        t = (r.get("type") or "doc").strip()
        note = (r.get("note") or r.get("desc") or "").strip()
        content = (
            r.get("content") or r.get("body") or r.get("description") or ""
        ).strip()
        if not content and note:
            content = note
        url = (r.get("url") or "").strip()
        origin = normalize_origin(
            r.get("origin") or r.get("cite") or r.get("source_name") or "",
            mat_type=t,
            url=url,
            title=title,
        )
        howto_find = (
            r.get("howto_find") or r.get("how_to_find") or r.get("find") or ""
        ).strip() or default_howto_find(
            title=title, mat_type=t, url=url, origin=origin
        )
        out.append(
            {
                "title": title[:80],
                "type": t,
                "type_label": TYPE_LABEL.get(t, t),
                "note": note[:120],
                "content": content[:1200],
                "url": url[:300],
                "origin": origin[:120],
                "howto_find": howto_find[:240],
                "source": source,
                "sort_order": i,
            }
        )
    return out


def merge_resources(primary: list[dict], secondary: list[dict], limit: int = 8) -> list[dict]:
    """按 title 去重，primary 优先。"""
    seen = set()
    merged = []
    for r in (primary or []) + (secondary or []):
        key = (r.get("title") or "").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(r)
        if len(merged) >= limit:
            break
    for i, r in enumerate(merged):
        r["sort_order"] = i
    return merged


def merge_learning_path(base: dict, llm_path: dict | None) -> dict:
    """目录地图打底，LLM 可补充 knowledge / frameworks（去重）。"""
    out = {
        "domain": base.get("domain") or "generic",
        "label": base.get("label") or "",
        "summary": (llm_path or {}).get("summary") or base.get("summary") or "",
        "knowledge": list(base.get("knowledge") or []),
        "frameworks": list(base.get("frameworks") or []),
        "howto": list(base.get("howto") or []),
    }
    if not isinstance(llm_path, dict):
        return out

    seen_k = {str(x) for x in out["knowledge"]}
    for k in llm_path.get("knowledge") or []:
        s = str(k).strip()
        if s and s not in seen_k:
            out["knowledge"].append(s)
            seen_k.add(s)

    seen_f = {(f.get("name") if isinstance(f, dict) else str(f)) for f in out["frameworks"]}
    for f in llm_path.get("frameworks") or []:
        if isinstance(f, dict):
            name = (f.get("name") or "").strip()
            if name and name not in seen_f:
                out["frameworks"].append(
                    {"name": name[:40], "note": (f.get("note") or "")[:80]}
                )
                seen_f.add(name)
        else:
            name = str(f).strip()
            if name and name not in seen_f:
                out["frameworks"].append({"name": name[:40], "note": ""})
                seen_f.add(name)

    if llm_path.get("howto"):
        # 保留目录 howto，附加 LLM 一条差异化建议
        for h in llm_path.get("howto") or []:
            s = str(h).strip()
            if s and s not in out["howto"]:
                out["howto"].append(s)
                break
    return out
