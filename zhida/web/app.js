(() => {
  const TOKEN_KEY = "zhida_ops_session";
  const USER_KEY = "zhida_ops_user";
  const state = { days: 30, data: null };

  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");

  function toast(msg) {
    toastEl.hidden = false;
    toastEl.textContent = msg;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
      toastEl.hidden = true;
    }, 2600);
  }

  function money(n, digits = 2) {
    const v = Number(n) || 0;
    return `¥${v.toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}`;
  }

  function num(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("zh-CN");
  }

  function pct(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return `${((Number(n) || 0) * 100).toFixed(1)}%`;
  }

  function apiBase() {
    if (location.protocol === "file:") return "http://127.0.0.1:8002";
    return "";
  }

  function sessionToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function authHeaders() {
    const t = sessionToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  function showApp(username) {
    const gate = $("loginGate");
    const shell = $("appShell");
    gate.hidden = true;
    gate.setAttribute("hidden", "");
    shell.hidden = false;
    shell.removeAttribute("hidden");
    $("railUser").textContent = username ? `已登录 · ${username}` : "运营监控";
  }

  function showLogin(err) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    const gate = $("loginGate");
    const shell = $("appShell");
    shell.hidden = true;
    shell.setAttribute("hidden", "");
    gate.hidden = false;
    gate.removeAttribute("hidden");
    const errEl = $("loginErr");
    if (err) {
      errEl.hidden = false;
      errEl.removeAttribute("hidden");
      errEl.textContent = err;
    } else {
      errEl.hidden = true;
      errEl.setAttribute("hidden", "");
      errEl.textContent = "";
    }
  }

  async function fetchSummary() {
    const t = sessionToken();
    if (!t) {
      showLogin();
      return null;
    }
    const res = await fetch(`${apiBase()}/api/admin/ops/summary?days=${state.days}`, {
      headers: { ...authHeaders() },
    });
    if (res.status === 401) {
      showLogin("登录已过期，请重新登录");
      return null;
    }
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function tryRestoreSession() {
    const t = sessionToken();
    if (!t) {
      showLogin();
      return false;
    }
    const res = await fetch(`${apiBase()}/api/admin/ops/me`, { headers: { ...authHeaders() } });
    if (!res.ok) {
      showLogin();
      return false;
    }
    const me = await res.json();
    const name = me.username || localStorage.getItem(USER_KEY) || "";
    localStorage.setItem(USER_KEY, name);
    showApp(name);
    return true;
  }

  async function doLogin(username, password) {
    const res = await fetch(`${apiBase()}/api/admin/ops/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let msg = "用户名或密码错误";
      try {
        const body = await res.json();
        if (body.detail) msg = typeof body.detail === "string" ? body.detail : msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, data.username || username);
    showApp(data.username || username);
  }

  function renderKpis(d) {
    const rev = d.revenue.amount_cny_in_range || 0;
    const test = d.revenue.test_orders || {};
    $("kpiProfit").textContent = money(rev);
    const delta = $("profitDelta");
    if (rev > 0) {
      delta.textContent = "已入账";
      delta.className = "delta up";
    } else {
      delta.textContent = "暂无真实收款";
      delta.className = "delta";
    }
    $("profitHint").textContent = `累计真实 ${money(d.revenue.amount_cny_all)} · ${d.revenue.orders_in_range} 笔`;

    $("kpiRevenue").textContent = money(test.amount_cny_in_range || 0);
    $("revenueHint").textContent = `开发单 ${test.orders_in_range || 0} 笔 · 累计 ${money(
      test.amount_cny_all || 0
    )}（不计收入）`;

    const tokens = d.ai.total_tokens_in_range || 0;
    $("kpiCost").textContent = num(tokens);
    $("costHint").textContent = `准确 ${d.ai.accurate_calls_in_range}/${d.ai.calls_in_range} 次 · 入 ${num(
      d.ai.prompt_tokens_in_range
    )} / 出 ${num(d.ai.completion_tokens_in_range)}`;

    $("kpiUsers").textContent = `${d.users.total} / ${d.users.members_active}`;
    $("usersHint").textContent = `创建率 ${pct(d.users.create_rate)} · 转化 ${pct(
      d.users.conversion_rate
    )} · 配额满 ${d.users.free_quota_capped}`;

    document.querySelectorAll(".kpi").forEach((el, i) => {
      setTimeout(() => el.classList.add("is-in"), 40 * i);
    });
  }

  function renderChart(series) {
    const el = $("financeChart");
    if (!series.length) {
      el.innerHTML = `<div style="padding:24px;color:var(--ink-3);font-size:13px">暂无序列数据</div>`;
      return;
    }
    const w = el.clientWidth || 640;
    const h = 220;
    const pad = { t: 18, r: 16, b: 28, l: 36 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const revs = series.map((s) => s.revenue_cny);
    const tokens = series.map((s) => s.total_tokens || 0);
    const users = series.map((s) => s.new_users || 0);
    const maxRev = Math.max(0.01, ...revs);
    const maxTok = Math.max(1, ...tokens);
    const maxUser = Math.max(1, ...users);

    const x = (i) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const yRev = (v) => pad.t + ih - (v / maxRev) * ih;
    const yTok = (v) => pad.t + ih - (v / maxTok) * ih;
    const yUser = (v) => pad.t + ih - (v / maxUser) * ih;

    function path(vals, yfn) {
      return vals
        .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yfn(Math.max(0, v)).toFixed(1)}`)
        .join(" ");
    }

    const labels = [0, Math.round(series.length / 2), series.length - 1]
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((i) => {
        const d = series[i]?.date?.slice(5) || "";
        return `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" fill="#6b7d7c" font-size="11">${d}</text>`;
      })
      .join("");

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ih}" stroke="rgba(16,38,38,.08)" />
      <line x1="${pad.l}" y1="${pad.t + ih}" x2="${pad.l + iw}" y2="${pad.t + ih}" stroke="rgba(16,38,38,.08)" />
      <path d="${path(revs, yRev)}" fill="none" stroke="#176c6b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${path(tokens, yTok)}" fill="none" stroke="#c4633f" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" />
      <path d="${path(users, yUser)}" fill="none" stroke="#2c7a62" stroke-width="1.6" opacity=".85" />
      ${labels}
    </svg>`;
    $("seriesMeta").textContent = `${series.length} 天 · 仅实测`;
  }

  function renderProfitStack(d) {
    const test = d.revenue.test_orders || {};
    const items = [
      { label: "真实收入", value: d.revenue.amount_cny_in_range, color: "#176c6b", money: true },
      { label: "开发测试单", value: test.amount_cny_in_range || 0, color: "#6b7d7c", money: true },
      {
        label: "真实 Token",
        value: d.ai.total_tokens_in_range || 0,
        color: "#c4633f",
        money: false,
      },
    ];
    const max = Math.max(0.01, ...items.map((i) => Math.abs(i.value)));
    $("profitStack").innerHTML = items
      .map(
        (i) => `<li>
        <span>${i.label}</span>
        <div class="bar"><div class="fill" style="background:${i.color}" data-w="${(Math.abs(i.value) / max) * 100}"></div></div>
        <span class="num">${i.money ? money(i.value) : num(i.value)}</span>
      </li>`
      )
      .join("");
    requestAnimationFrame(() => {
      $("profitStack").querySelectorAll(".fill").forEach((el) => {
        el.style.width = `${el.dataset.w}%`;
      });
    });

    const pol = d.data_policy || {};
    $("dataQuality").innerHTML = `<strong>口径</strong>：${pol.revenue || ""}；
      ${pol.test_orders || ""}；${pol.ai || ""}。
      排除假算 token <strong>${d.ai.inaccurate_calls_in_range}</strong> 次。
      ${pol.note || ""}`;
  }

  function renderPurpose(d) {
    const rows = d.ai.by_purpose || [];
    $("purposeBody").innerHTML = rows.length
      ? rows
          .map(
            (r) => `<tr>
          <td>${r.purpose}</td>
          <td class="num">${r.accurate_calls}/${r.calls}</td>
          <td class="num">${num(r.prompt_tokens)}</td>
          <td class="num">${num(r.completion_tokens)}</td>
          <td class="num">${num(r.total_tokens)}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="5" style="color:var(--ink-3)">区间内无 AI 调用</td></tr>`;
  }

  function card(tag, name, val, sub) {
    return `<div class="metric-card">
      <div class="tag">${tag}</div>
      <div class="name">${name}</div>
      <div class="val">${val}</div>
      <div class="sub">${sub || ""}</div>
    </div>`;
  }

  function renderMetrics(d) {
    const m = d.metrics || {};
    const p0 = m.p0 || {};
    const p1 = m.p1 || {};
    const p2 = m.p2 || {};
    const tc = p0.task_completion_rate || {};
    const ai = p0.ai_cost_per_user || {};

    $("p0Grid").innerHTML = [
      card(
        "P0",
        "目标创建率",
        pct(p0.goal_create_rate?.value),
        `${p0.goal_create_rate?.users_with_goal || 0} / ${p0.goal_create_rate?.users_total || 0}`
      ),
      card(
        "P0",
        "计划确认率",
        pct(p0.plan_confirm_rate?.value),
        `已确认 ${p0.plan_confirm_rate?.confirmed_goals || 0} · planning ${p0.plan_confirm_rate?.planning || 0}`
      ),
      card(
        "P0",
        "任务完成率",
        pct(tc.overall),
        `今日 ${pct(tc.today)} · 近7日 ${pct(tc.week)} · ${tc.due_done || 0}/${tc.due || 0}`
      ),
      card(
        "P0",
        "免费配额触顶",
        pct(p0.free_quota_capped_rate?.value),
        `${p0.free_quota_capped_rate?.capped_users || 0} / ${p0.free_quota_capped_rate?.free_users || 0}（上限 ${p0.free_quota_capped_rate?.limit || 5}）`
      ),
      card(
        "P0",
        "人均真实 Token",
        num(ai.mean_tokens),
        `P50 ${num(ai.p50_tokens)} · P95 ${num(ai.p95_tokens)} · ${ai.users_with_accurate_usage || 0} 人`
      ),
      card(
        "P0",
        "会员转化率",
        pct(p0.membership_conversion_rate?.value),
        `${p0.membership_conversion_rate?.members_active || 0} / ${p0.membership_conversion_rate?.users_total || 0}`
      ),
    ].join("");

    const ret = p1.retention || {};
    const adj = p1.replan_accept_rate || {};
    const sk = p1.skill_confirm_rate || {};
    const mk = p1.market_hit_rate || {};
    const rn = p1.membership_renewal || {};

    $("p1Grid").innerHTML = [
      card("P1", "次日留存 D1", pct(ret.d1?.rate), `留存 ${ret.d1?.retained || 0} / 合格队列 ${ret.d1?.eligible || 0}`),
      card("P1", "7 日留存 D7", pct(ret.d7?.rate), `留存 ${ret.d7?.retained || 0} / 合格队列 ${ret.d7?.eligible || 0}`),
      card("P1", "30 日留存 D30", pct(ret.d30?.rate), `留存 ${ret.d30?.retained || 0} / 合格队列 ${ret.d30?.eligible || 0}`),
      card(
        "P1",
        "调整接受率",
        pct(adj.accept_rate),
        `应用 v2+ ${adj.applied_versions_v2plus || 0} · 回滚 ${adj.rollback_versions || 0} · 延期任务 ${adj.deferred_tasks || 0}`
      ),
      card(
        "P1",
        "技能确认写入率",
        pct(sk.value),
        `证据 ${sk.confirmed || 0}/${sk.total || 0} · 档案 ${sk.user_skills || 0}`
      ),
      card(
        "P1",
        "市场命中率",
        pct(mk.value),
        `market ${mk.market || 0} · llm ${mk.llm || 0} · fallback ${mk.fallback || 0} · 目录 ${mk.market_catalog_items || 0}`
      ),
      card(
        "P1",
        "会员续费率",
        pct(rn.renewal_rate),
        `真实支付复购 ${rn.renewers || 0}/${rn.payers || 0} · 7日内到期 ${rn.expiring_in_7d || 0}`
      ),
    ].join("");

    const skip = p2.skill_skip_hit_rate || {};
    const grp = p2.groups || {};
    const fb = p2.plan_fallback_rate || {};
    const aq = p2.ai_usage_quality || {};

    $("p2Grid").innerHTML = [
      card(
        "P2",
        "档案跳过命中",
        pct(skip.value),
        `跳过阶段 ${skip.skipped_stages || 0}/${skip.stages_total || 0}`
      ),
      card(
        "P2",
        "小组合入率",
        pct(grp.user_join_rate),
        `组 ${grp.groups || 0} · 成员 ${grp.members || 0} · 关联目标 ${grp.goal_links || 0}`
      ),
      card(
        "P2",
        "规划 Fallback 率",
        pct(fb.value),
        `fallback ${fb.fallback_goals || 0} / 已知来源 ${fb.known_goals || 0}`
      ),
      card(
        "P2",
        "AI Usage 准确率",
        pct(aq.accurate_rate),
        `真实 ${aq.accurate_calls_in_range || 0} · 排除假算 ${aq.inaccurate_calls_in_range || 0}`
      ),
    ].join("");
  }

  function renderGoals(d) {
    $("goalStats").innerHTML = `
      <div><div class="k">目标总数</div><div class="v">${d.goals.total}</div></div>
      <div><div class="k">确认率</div><div class="v">${pct(d.goals.confirm_rate)}</div></div>
      <div><div class="k">任务完成率</div><div class="v">${pct(d.tasks.completion_rate)}</div></div>
      <div><div class="k">已完成任务</div><div class="v">${d.tasks.done}</div></div>
    `;
    const statuses = Object.entries(d.goals.by_status || {});
    const max = Math.max(1, ...statuses.map(([, n]) => n));
    $("statusBars").innerHTML = statuses
      .map(
        ([k, n]) => `<div class="row">
        <span>${k}</span>
        <div class="track"><div class="fill" data-w="${(n / max) * 100}"></div></div>
        <span class="num">${n}</span>
      </div>`
      )
      .join("");
    requestAnimationFrame(() => {
      $("statusBars").querySelectorAll(".fill").forEach((el) => {
        el.style.width = `${el.dataset.w}%`;
      });
    });
    const plans = d.revenue.by_plan || [];
    $("planBody").innerHTML = plans.length
      ? plans
          .map(
            (p) => `<tr>
          <td>${p.plan}</td>
          <td class="num">${p.orders}</td>
          <td class="num">${(p.amount_cents / 100).toFixed(2)}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="color:var(--ink-3)">暂无真实支付订单</td></tr>`;
  }

  function renderAll(d) {
    state.data = d;
    $("rangeLabel").textContent = `${d.range.start.slice(0, 10)} → ${d.range.end.slice(0, 10)} · ${
      d.range.days
    } 日 · 仅真实数据`;
    renderKpis(d);
    renderChart(d.series || []);
    renderProfitStack(d);
    renderMetrics(d);
    renderPurpose(d);
    renderGoals(d);
    $("pricingNote").textContent =
      d.data_policy?.note ||
      "收入仅真实支付；开发开通单单独展示；AI 只统计接口真实 token，不做金额折算。";
  }

  async function load() {
    try {
      const d = await fetchSummary();
      if (d) renderAll(d);
    } catch (err) {
      console.error(err);
      toast(`加载失败：${err.message || err}`);
    }
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("loginBtn");
    btn.disabled = true;
    try {
      await doLogin($("loginUser").value.trim(), $("loginPass").value);
      $("loginPass").value = "";
      await load();
    } catch (err) {
      showLogin(err.message || "登录失败");
    } finally {
      btn.disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", () => {
    showLogin();
    toast("已退出");
  });
  $("refreshBtn").addEventListener("click", load);

  document.querySelectorAll(".seg [data-days]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg [data-days]").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      state.days = Number(btn.dataset.days);
      load();
    });
  });

  document.querySelectorAll(".nav-item[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const target = document.getElementById(btn.dataset.jump);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  window.addEventListener("resize", () => {
    if (state.data) renderChart(state.data.series || []);
  });

  (async () => {
    const ok = await tryRestoreSession();
    if (ok) await load();
  })();
})();
