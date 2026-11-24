const { Plugin, ItemView, PluginSettingTab, Setting, requestUrl } = require("obsidian");

const VIEW_TYPE = "openrouter-copilot-view";
const DEFAULT_MODEL = "openrouter/free";

// ---------- Right-side split Copilot panel ----------
class CopilotView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentFile = null;
    this.currentContent = "";
    this.messages = [];
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "OpenRouter Copilot";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("copilot-view");
    this.render(container);
    await this.refreshFromActiveFile();
  }

  render(container) {
    container.createEl("h2", { text: "OpenRouter Copilot" });

    // Current file info
    this.fileInfoEl = container.createEl("div", { cls: "copilot-file-info" });
    this.fileInfoEl.textContent = "Current file: None";

    // Conversation history (scrollable)
    this.historyEl = container.createEl("div", { cls: "copilot-history" });

    // Input area at bottom (fixed)
    const inputBar = container.createEl("div", { cls: "copilot-input-bar" });
    this.inputEl = inputBar.createEl("input", {
      type: "text",
      placeholder: "Ask about this note…",
    });
    this.sendBtn = inputBar.createEl("button", { text: "Send" });

    this.statusEl = container.createEl("div", { cls: "copilot-status" });
    this.statusEl.textContent = "Ready";

    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  // file: optional Markdown file to display. Falls back to plugin's last known file.
  async refreshFromActiveFile(file = null) {
    if (!file) {
      file = this.plugin.lastActiveFile || this.app.workspace.getActiveFile();
    }

    let content = "";
    if (file) {
      try {
        content = await this.app.vault.cachedRead(file);
      } catch (e) {
        try {
          content = await this.app.vault.read(file);
        } catch (e2) {
          content = "";
        }
      }
    }

    this.currentFile = file;
    this.currentContent = content;

    if (this.fileInfoEl) {
      this.fileInfoEl.textContent = file
        ? `Current file: ${file.name}`
        : "Current file: None";
    }
  }

  addMessage(role, text) {
    const wrap = this.historyEl.createEl("div", { cls: `copilot-msg copilot-msg-${role}` });
    const bubble = wrap.createEl("div", { cls: "copilot-bubble" });

    if (role === "assistant") {
      this.renderMarkdown(bubble, text);
    } else {
      bubble.textContent = text;
    }

    this.scrollToBottom();
    return wrap;
  }

  scrollToBottom() {
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  renderMarkdown(el, markdown) {
    el.innerHTML = "";
    this.app.markdownRenderer.render(markdown, el, this.currentFile?.path || "", this);
  }

  async handleSend() {
    const question = this.inputEl.value.trim();
    if (!question) return;

    const settings = this.plugin.settings || {};
    if (!settings.apiKey) {
      this.showError("OpenRouter API Key not configured. Please fill in and save in plugin settings.");
      return;
    }
    if (!this.currentFile) {
      this.showError("No active Markdown file. Please open a note first.");
      return;
    }

    this.addMessage("user", question);
    this.inputEl.value = "";

    const assistantWrap = this.addMessage("assistant", "…");
    const bubble = assistantWrap.querySelector(".copilot-bubble");

    this.sendBtn.disabled = true;
    this.statusEl.textContent = "Requesting…";

    try {
      const res = await requestUrl({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://obsidian.md",
          "X-Title": "OpenRouter Copilot",
        },
        body: JSON.stringify({
          model: settings.model || DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are an Obsidian note assistant. Answer the user's question concisely based on the current note content provided.",
            },
            {
              role: "user",
              content: `Current note "${this.currentFile.name}" content:\n---\n${this.currentContent}\n---\n\nQuestion: ${question}`,
            },
          ],
        }),
      });

      const data = res.json;
      const answer = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content || "(Empty response)"
        : "OpenRouter returned malformed data";
      this.renderMarkdown(bubble, answer);
    } catch (err) {
      this.renderMarkdown(bubble, `Request failed: ${err.message || String(err)}`);
    } finally {
      this.sendBtn.disabled = false;
      this.statusEl.textContent = "Ready";
      this.scrollToBottom();
    }
  }

  showError(msg) {
    const errEl = this.historyEl.createEl("div", { cls: "copilot-msg copilot-msg-error" });
    const bubble = errEl.createEl("div", { cls: "copilot-bubble copilot-error" });
    bubble.textContent = msg;
    this.scrollToBottom();
  }
}

// ---------- Plugin settings tab ----------
class OpenRouterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "OpenRouter Copilot Settings" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("API Key from https://openrouter.ai")
      .addText((text) =>
        text
          .setPlaceholder("sk-or-...")
          .setValue(this.plugin.settings.apiKey || "")
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName("Model Name")
      .setDesc("OpenRouter model ID, e.g. openrouter/free, anthropic/claude-3-haiku, etc.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_MODEL)
          .setValue(this.plugin.settings.model || DEFAULT_MODEL)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_MODEL;
            await this.plugin.saveData(this.plugin.settings);
          })
      );
  }
}

// ---------- Plugin main body ----------
module.exports = class OpenRouterCopilotPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.settings = { apiKey: "", model: DEFAULT_MODEL };
    this.copilotLeaf = null;
    this.isSplitting = false;
    this.lastActiveFile = null; // track the last Markdown file the user was reading
  }

  async onload() {
    const saved = await this.loadData();
    if (saved && typeof saved === "object") {
      this.settings = { ...this.settings, ...saved };
    }

    this.registerView(VIEW_TYPE, (leaf) => new CopilotView(leaf, this));
    this.addSettingTab(new OpenRouterSettingTab(this.app, this));

    this.addCommand({
      id: "open-openrouter-copilot",
      name: "Open OpenRouter Copilot",
      callback: () => {
        this.openCopilot();
      },
    });

    // Detect when user switches to a Markdown note so Copilot can follow
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.onActiveLeafChanged(leaf);
      })
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async onActiveLeafChanged(leaf) {
    if (this.isSplitting) return;
    if (!leaf) return;

    const view = leaf.view;
    const file = view ? view.file : null;

    // Remember the last Markdown file the user opened
    if (file && file.extension === "md") {
      this.lastActiveFile = file;
    }

    // If the user clicked into the Copilot panel itself, just refresh it from
    // the last known Markdown file (don't create another split / loop).
    if (view && view.getViewType && view.getViewType() === VIEW_TYPE) {
      await this.refreshCopilot();
      return;
    }

    // If it's a Markdown file, auto-open/follow Copilot
    if (file) {
      await this.ensureCopilotLeaf();
    }
  }

  async refreshCopilot() {
    const copilotView = this.getCopilotView();
    if (copilotView && typeof copilotView.refreshFromActiveFile === "function") {
      await copilotView.refreshFromActiveFile(this.lastActiveFile);
    }
  }

  getCopilotView() {
    if (!this.copilotLeaf || this.copilotLeaf.isDetached()) return null;
    return this.copilotLeaf.view;
  }

  async openCopilot() {
    await this.ensureCopilotLeaf();
  }

  async ensureCopilotLeaf() {
    let leaf = this.copilotLeaf;

    if (leaf && !leaf.isDetached()) {
      await this.refreshCopilot();
      return;
    }

    if (this.isSplitting) return;
    this.isSplitting = true;
    try {
      leaf = this.app.workspace.getLeaf("split");
      await leaf.setViewState({ type: VIEW_TYPE, state: {} });
      this.copilotLeaf = leaf;
      await this.refreshCopilot();
    } catch (err) {
      console.error("[OpenRouter Copilot] Failed to create split:", err);
    } finally {
      this.isSplitting = false;
    }
  }
};
