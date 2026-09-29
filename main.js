/* QS-8 Score Panel —— 八维加权章节评分面板
 * 规则移植自 novel-ai-writing-system/docs/methodology 量化评价体系（QS-8）：
 *   D1 开局钩子15% D2 章末钩子15% D3 冲突张力20% D4 节奏10% D5 具体性15%
 *   D6 对话人味10% D7 信息密度5% D8 逻辑动机10%；总分 0-10，<7 不进正文库。
 * D4/D5/D6 脚本可测 → 自动打分；D1/D2/D3/D7/D8 人工/LLM 判读 → 面板滑条。
 * 每次评分可追加到记分台账（默认 QS8记分.md），供后续回归校准权重。
 */
const { Plugin, ItemView, Notice, PluginSettingTab, Setting, MarkdownView } = require("obsidian");

const VIEW_TYPE = "qs8-panel-view";

const WEIGHTS = { D1: 15, D2: 15, D3: 20, D4: 10, D5: 15, D6: 10, D7: 5, D8: 10 };
const JUDGE_DIMS = [
  ["D1", "开局钩子", "前200字是否最快制造「必须读下去」的理由"],
  ["D2", "章末钩子", "结尾停在未闭合状态（悬念/转折/升级/倒计时）"],
  ["D3", "冲突与张力", "每千字有效冲突/欲望受阻次数"],
  ["D7", "信息密度", "每千字新信息量 vs 填充水词"],
  ["D8", "逻辑与动机", "因果闭合、无「突然」，行为有内在动机"],
];

// 物件词池（场景具体性，show 不 tell）
const OBJECT_WORDS = ["枪","刀","剑","灯","烛","桌","椅","床","镜","纸","墨","笔","书","信","窗","门","帘","碗","壶","杯","酒","茶","铜管","账","笏","印","玺","朱笔","炭盆","油灯","玉","簪","钗","银子","钥匙","地图","舆图","名单","奏折","圣旨","药","汤","婚书","照片","手机","合同","工牌","外卖","红包"];
const SENSE_WORDS = ["腥","焦","凉","烫","涩","滑","糙","嗡","嗒","咯吱","窸窣","苦","咸","腥甜","冷","闷热","刺鼻","震","颤"];
const TELL_WORDS = ["悲伤","愤怒","恐惧","紧张","幸福","痛苦","绝望","害怕","开心","高兴","难过","感动","震撼","震惊","温暖","美好","心酸","心疼","激动","兴奋"];
const TAG_WORDS = ["说","道","喊","叫","问","答","嘀咕","嘟囔","吼","嚷","叹","嗤","骂","劝","求","哭","笑","嗔","念叨","应","接话","插嘴","回"];

function scoreD4(sentLens) {
  // 节奏：句长变异系数 CV 越大越好（双峰/极端值），短句占比加分，"节拍器化"扣分
  if (sentLens.length < 10) return { score: null, detail: "文本过短" };
  const n = sentLens.length;
  const mean = sentLens.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(sentLens.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const cv = sd / mean;
  const shortShare = sentLens.filter((l) => l <= 8).length / n;
  let s = 0;
  s += Math.min(7, cv * 9);            // CV 0.75→6.75 分
  s += Math.min(3, shortShare * 12);   // 短句占比 25%→3 分
  return { score: Math.round(s * 10) / 10, detail: `CV=${cv.toFixed(2)} 短句${Math.round(shortShare * 100)}% 均句长${mean.toFixed(0)}` };
}

function scoreD5(text, per1000) {
  let objHits = 0;
  for (const w of OBJECT_WORDS) { let i = text.indexOf(w); while (i >= 0) { objHits++; i = text.indexOf(w, i + w.length); } }
  let senseHits = 0;
  for (const w of SENSE_WORDS) { let i = text.indexOf(w); while (i >= 0) { senseHits++; i = text.indexOf(w, i + w.length); } }
  let tellHits = 0;
  for (const w of TELL_WORDS) { let i = text.indexOf(w); while (i >= 0) { tellHits++; i = text.indexOf(w, i + w.length); } }
  const density = objHits / per1000;
  let s = 0;
  s += Math.min(6, density * 6);       // 物件词 10/千字 → 6 分
  s += Math.min(2, senseHits / per1000 * 8);
  s += tellHits === 0 ? 2 : Math.max(0, 2 - tellHits / per1000 * 4); // tell 扣分
  return { score: Math.round(s * 10) / 10, detail: `物件词${density.toFixed(1)}/千字 感官${(senseHits / per1000).toFixed(1)}/千字 直述情绪${(tellHits / per1000).toFixed(1)}/千字` };
}

function scoreD6(text, per1000) {
  const dialogues = text.match(/[「"”][^」"”]{2,}[」"“]/g) || [];
  if (!dialogues.length) return { score: 3, detail: "无对话（本章若应为对话章请人工复核）" };
  const tags = new Set();
  for (const t of TAG_WORDS) if (text.includes(t)) tags.add(t);
  const dialChars = dialogues.join("").length;
  const density = dialogues.length / per1000;
  let s = 0;
  s += Math.min(5, tags.size * 0.45);  // 标签多样性 11 种 → 5 分
  s += Math.min(3, density * 6);       // 对话密度 0.15 → 3 分
  const avgLen = dialChars / dialogues.length;
  s += avgLen <= 14 ? 2 : avgLen <= 22 ? 1 : 0; // 口语化短对话加分
  return { score: Math.round(s * 10) / 10, detail: `对话${dialogues.length}处 密度${density.toFixed(3)} 标签${tags.size}种 均长${avgLen.toFixed(0)}字` };
}

function verdict(total) {
  if (total >= 8) return ["🟢 可发布", "var(--text-success)"];
  if (total >= 7) return ["🟡 小修后发布", "var(--text-warning)"];
  if (total >= 5.5) return ["🟠 大修", "var(--text-error)"];
  return ["🔴 返工（<7 不进正文库）", "var(--text-error)"];
}

module.exports = class Qs8Panel extends Plugin {
  async onload() {
    this.settings = Object.assign({}, { ledger: "QS8记分.md", dimsJson: "" }, await this.loadData());
    this.addRibbonIcon("gauge", "QS-8 评分面板", () => this.openPanel());
    this.addCommand({ id: "open-panel", name: "打开评分面板（当前笔记）", callback: () => this.openPanel() });
    this.addSettingTab(new Qs8SettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new Qs8View(leaf, this));
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
  async saveSettings() { await this.saveData(this.settings); }

  /** 维度定义：设置 JSON 可整体替换（换领域=换维度表），坏配置回退内置 QS-8 */
  dims() {
    const fallback = [
      { dim: "D1", label: "开局钩子", weight: 15, judge: true, desc: "前200字是否最快制造「必须读下去」的理由" },
      { dim: "D2", label: "章末钩子", weight: 15, judge: true, desc: "结尾停在未闭合状态（悬念/转折/升级/倒计时）" },
      { dim: "D3", label: "冲突与张力", weight: 20, judge: true, desc: "每千字有效冲突/欲望受阻次数" },
      { dim: "D4", label: "节奏", weight: 10, judge: false, desc: "句长变异系数+短句占比" },
      { dim: "D5", label: "具体性", weight: 15, judge: false, desc: "物件词/感官词密度，直述情绪扣分" },
      { dim: "D6", label: "对话人味", weight: 10, judge: false, desc: "标签多样性+对话密度+口语长度" },
      { dim: "D7", label: "信息密度", weight: 5, judge: true, desc: "每千字新信息量 vs 填充水词" },
      { dim: "D8", label: "逻辑与动机", weight: 10, judge: true, desc: "因果闭合、无「突然」，行为有内在动机" },
    ];
    if (this.settings.dimsJson) {
      try {
        const arr = JSON.parse(this.settings.dimsJson);
        if (Array.isArray(arr) && arr.length && arr.every((d) => d && d.dim && typeof d.weight === "number")) return arr;
      } catch (e) {}
    }
    return fallback;
  }

  async openPanel() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) { new Notice("请先打开一篇章节笔记"); return; }
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    leaf.view.render(view);
  }

  async appendLedger(row) {
    const path = this.settings.ledger;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      file = await this.app.vault.create(path, "# QS-8 记分台账\n\n| 文件 | 总分 | 判定 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | 日期 |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n");
    }
    const cur = await this.app.vault.read(file);
    await this.app.vault.modify(file, cur.replace(/\s*$/, "\n") + row + "\n");
    new Notice("已记入台账 " + path);
  }
};

class Qs8View extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "QS-8 评分"; }
  getIcon() { return "gauge"; }

  render(mdView) {
    const { contentEl } = this;
    contentEl.empty();
    const raw = mdView.editor.getValue().replace(/^---[\s\S]*?---\n/, "");
    const text = raw.replace(/[#>*`\-\|]/g, "").replace(/\s+/g, "");
    const per1000 = Math.max(1, text.length / 1000);
    const sentLens = raw.replace(/「[^」]*」/g, (m) => m.replace(/[。！？]/g, "，")) // 对话内断句不计
      .split(/[。！？]/).map((s) => s.replace(/\s+/g, "").length).filter((l) => l > 0);

    contentEl.createEl("h4", { text: `QS-8 · ${mdView.file ? mdView.file.basename : ""}` });

    // --- 脚本项 ---
    const auto = {};
    const d4 = scoreD4(sentLens); auto.D4 = d4.score;
    const d5 = scoreD5(text, per1000); auto.D5 = d5.score;
    const d6 = scoreD6(text, per1000); auto.D6 = d6.score;
    const autoEl = contentEl.createDiv();
    for (const [dim, r] of [["D4 节奏", d4], ["D5 具体性", d5], ["D6 对话人味", d6]]) {
      const row = autoEl.createDiv();
      row.style.cssText = "padding:5px 8px; margin-bottom:4px; background:var(--background-secondary); border-radius:6px; font-size:12px;";
      row.createEl("div", { text: `${dim}（脚本）：${r.score == null ? "—" : r.score}/10`, attr: { style: "font-weight:600;" } });
      row.createEl("div", { text: r.detail, attr: { style: "color:var(--text-muted);" } });
    }

    // --- 人工判读滑条 ---
    const manual = {};
    const allDims = this.plugin.dims();
    const judgeDims = allDims.filter((d) => d.judge);
    for (const { dim, label: name, weight, desc } of judgeDims) {
      const row = contentEl.createDiv();
      row.style.marginBottom = "4px";
      const label = row.createEl("label", {
        text: `${dim} ${name}（${weight}%）`,
        attr: { style: "font-size:12px; font-weight:600; display:block;" },
      });
      label.title = desc;
      const slider = row.createEl("input", { type: "range", attr: { min: "0", max: "10", step: "1", value: "7" } });
      slider.style.width = "100%";
      const val = row.createEl("span", { text: "7", attr: { style: "font-size:11px; color:var(--text-muted);" } });
      slider.oninput = () => { val.setText(slider.value); recalc(); };
      manual[dim] = { slider };
    }

    const totalEl = contentEl.createDiv();
    totalEl.style.cssText = "font-size:18px; font-weight:700; margin:8px 0;";

    const recalc = () => {
      const get = (d) => {
        if (auto[d] != null) return auto[d];
        if (manual[d]) return parseFloat(manual[d].slider.value);
        return 7; // 文本过短等无脚本分时按锚点中位兜底
      };
      const judged = {};
      for (const { dim } of judgeDims) judged[dim] = parseFloat(manual[dim].slider.value);
      let sum = 0;
      for (const { dim, weight } of allDims) sum += get(dim) * weight;
      const total = Math.round(sum / 100 * 10) / 10;
      const [v, color] = verdict(total);
      totalEl.setText(`总分 ${total}/10 → ${v}`);
      totalEl.style.color = color;
      this._total = total;
      this._parts = { ...auto, ...judged };
    };
    recalc();

    // 脚本项覆盖滑条（允许人工修正）
    const override = contentEl.createEl("details");
    override.createEl("summary", { text: "修正脚本项打分", attr: { style: "font-size:12px; cursor:pointer;" } });
    this._overrideInputs = {};
    for (const d of allDims.filter((x) => !x.judge).map((x) => x.dim)) {
      const row = override.createDiv();
      row.style.cssText = "display:flex; gap:6px; align-items:center; font-size:12px; margin:2px 0;";
      row.createEl("span", { text: d });
      const inp = row.createEl("input", { type: "number", attr: { min: "0", max: "10", step: "0.5", value: String(auto[d] ?? 7) } });
      inp.style.width = "60px";
      inp.oninput = () => { auto[d] = parseFloat(inp.value); recalc(); };
    }

    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex; gap:8px; margin-top:8px;";
    const save = btns.createEl("button", { text: "记入台账", cls: "mod-cta" });
    save.onclick = () => {
      const p = this._parts;
      const row = `| ${mdView.file ? mdView.file.basename : "未命名"} | ${this._total} | ${verdict(this._total)[0].replace(/[^\u4e00-\u9fa5（）]/g, "")} | ${p.D1} | ${p.D2} | ${p.D3} | ${p.D4} | ${p.D5} | ${p.D6} | ${p.D7} | ${p.D8} | ${new Date().toISOString().slice(0, 10)} |`;
      this.plugin.appendLedger(row);
    };
  }

  onClose() { this.contentEl.empty(); }
}

class Qs8SettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("记分台账文件").setDesc("库内路径，不存在自动创建").addText((t) =>
      t.setValue(this.plugin.settings.ledger).onChange(async (v) => {
        this.plugin.settings.ledger = v.trim() || "QS8记分.md";
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("维度与权重（JSON，可选）")
      .setDesc('整体替换内置 QS-8 八维。格式 [{dim,label,weight,judge,desc}]，judge:true=人工滑条，false=脚本自动（D4节奏/D5具体性/D6对话）。换领域=换维度表，如议论文/周报/剧本')
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.dimsJson || "");
        t.inputEl.style.minHeight = "120px";
        t.inputEl.style.fontFamily = "monospace";
        t.onChange(async (v) => {
          this.plugin.settings.dimsJson = v;
          await this.plugin.saveSettings();
        });
      });
  }
}
