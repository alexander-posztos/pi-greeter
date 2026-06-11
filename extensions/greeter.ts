import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";

type DashboardAction = "new" | "resume" | "config" | "update" | "lazygit" | "quit" | "close";
type LogoVariant = "pi" | "text" | "compact";

interface DashboardConfig {
	showOnStartup?: boolean | "fresh";
	icons?: boolean;
	showCwd?: boolean;
	logo?: LogoVariant;
}

const configPath = process.env.PI_GREETER_CONFIG || join(homedir(), ".pi-greeter.json");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeShowOnStartup(value: unknown): boolean | "fresh" {
	return value === false || value === "fresh" ? value : true;
}

function normalizeLogo(value: unknown): LogoVariant {
	return value === "text" || value === "compact" || value === "pi" ? value : "pi";
}

function loadConfig(ctx: ExtensionContext | ExtensionCommandContext): DashboardConfig {
	if (!existsSync(configPath)) return { showOnStartup: true, icons: true, showCwd: false, logo: "pi" };
	try {
		const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
		if (!isRecord(parsed)) return { showOnStartup: true, icons: true, showCwd: false, logo: "pi" };
		return {
			showOnStartup: normalizeShowOnStartup(parsed.showOnStartup),
			icons: typeof parsed.icons === "boolean" ? parsed.icons : true,
			showCwd: typeof parsed.showCwd === "boolean" ? parsed.showCwd : false,
			logo: normalizeLogo(parsed.logo),
		};
	} catch {
		// No console output here: pi does not capture console in interactive mode, it would corrupt the TUI.
		ctx.ui.notify(`pi-greeter: could not read ${configPath} - using defaults`, "warning");
		return { showOnStartup: true, icons: true, showCwd: false, logo: "pi" };
	}
}

const logos: Record<LogoVariant, string> = {
	pi: String.raw`

                 ███████████████████████████████████████████████
                ████████████████████████████████████████████████
               ████████████████████████████████████████████████
               ████████████████████████████████████████████████
               ██    ████████████        ████████████
               █    ████████████        ████████████
                   ████████████        ████████████
                   ████████████        ████████████
                  ████████████        ████████████
                 ████████████        ████████████
                ████████████        ████████████
              ██████████████      ██████████████
             ██████████████      ██████████████
            ██████████████      ██████████████
 `,
	text: String.raw`
██████╗ ██╗     ██████╗ ██████╗ ██████╗ ██╗███╗   ██╗ ██████╗      █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██╔══██╗██║    ██╔════╝██╔═══██╗██╔══██╗██║████╗  ██║██╔════╝     ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
██████╔╝██║    ██║     ██║   ██║██║  ██║██║██╔██╗ ██║██║  ███╗    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   
██╔═══╝ ██║    ██║     ██║   ██║██║  ██║██║██║╚██╗██║██║   ██║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   
██║     ██║    ╚██████╗╚██████╔╝██████╔╝██║██║ ╚████║╚██████╔╝    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   
╚═╝     ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝
`,
	compact: String.raw`
██████╗ ██╗
██╔══██╗██║
██████╔╝██║
██╔═══╝ ██║
██║     ██║
╚═╝     ╚═╝
`,
};

const actions: Array<{ key: string; icon: string; asciiIcon: string; label: string; action: DashboardAction }> = [
	{ key: "n", icon: "", asciiIcon: "+", label: "New session", action: "new" },
	{ key: "r", icon: "󱑆", asciiIcon: "~", label: "Resume session", action: "resume" },
	{ key: "c", icon: "", asciiIcon: "*", label: "Config", action: "config" },
	{ key: "u", icon: "󰚥", asciiIcon: "^", label: "Update", action: "update" },
	{ key: "g", icon: "󰊢", asciiIcon: "#", label: "Lazygit", action: "lazygit" },
	{ key: "q", icon: "󰩈", asciiIcon: "x", label: "Quit", action: "quit" },
];

function sessionIsEmpty(ctx: ExtensionContext | ExtensionCommandContext): boolean {
	return !ctx.sessionManager.getEntries().some((entry) => {
		if (entry.type === "message") return ["user", "assistant", "toolResult"].includes(entry.message.role);
		return entry.type === "custom_message" || entry.type === "compaction" || entry.type === "branch_summary";
	});
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function commandAvailable(pi: ExtensionAPI, command: string): Promise<boolean> {
	const result = await pi.exec("sh", ["-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`], { timeout: 3000 });
	return result.code === 0;
}

function tmuxSessionActive(): boolean {
	return Boolean(process.env.TMUX);
}

async function openTmuxWindow(pi: ExtensionAPI, cwd: string, name: string, command: string): Promise<boolean> {
	if (!tmuxSessionActive() || !(await commandAvailable(pi, "tmux"))) return false;
	const result = await pi.exec("tmux", ["new-window", "-c", cwd, "-n", name, command], { timeout: 5000 });
	return result.code === 0;
}

function center(line: string, width: number): string {
	const pad = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
	return " ".repeat(pad) + truncateToWidth(line, width);
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const ansiRgb = (hex: string, text: string) => {
	const normalized = hex.replace("#", "");
	const r = parseInt(normalized.slice(0, 2), 16);
	const g = parseInt(normalized.slice(2, 4), 16);
	const b = parseInt(normalized.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
};
const piBlue = (text: string) => ansiRgb("#89ddff", text);
const piOrange = (text: string) => ansiRgb("#ff9e64", text);
const logoGradientTop = "#46c4ff";
const logoGradientBottom = "#1e88c3";

function lerp(start: number, end: number, amount: number): number {
	return Math.round(start + (end - start) * amount);
}

function logoGradientColor(lineIndex: number, lineCount: number): string {
	const amount = lineCount <= 1 ? 0 : lineIndex / (lineCount - 1);
	const top = logoGradientTop.replace("#", "");
	const bottom = logoGradientBottom.replace("#", "");
	const r = lerp(parseInt(top.slice(0, 2), 16), parseInt(bottom.slice(0, 2), 16), amount);
	const g = lerp(parseInt(top.slice(2, 4), 16), parseInt(bottom.slice(2, 4), 16), amount);
	const b = lerp(parseInt(top.slice(4, 6), 16), parseInt(bottom.slice(4, 6), 16), amount);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function getLogoLines(variant: LogoVariant): string[] {
	const lines = logos[variant].split("\n");
	while (lines[0]?.trim() === "") lines.shift();
	while (lines[lines.length - 1]?.trim() === "") lines.pop();
	return lines;
}

function colorLogoLine(line: string, lineIndex: number, lineCount: number): string {
	return ansiRgb(logoGradientColor(lineIndex, lineCount), line);
}

function padRightVisible(line: string, targetWidth: number): string {
	return line + " ".repeat(Math.max(0, targetWidth - visibleWidth(line)));
}

class AlphaDashboard implements Component {
	private selected = 0;
	private cachedWidth?: number;
	private cachedHeight?: number;
	private cachedLines?: string[];

	constructor(
		private tui: TUI,
		private theme: Theme,
		private ctx: ExtensionContext | ExtensionCommandContext,
		private config: DashboardConfig,
		private done: (action: DashboardAction) => void,
	) {}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedHeight = undefined;
		this.cachedLines = undefined;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) return this.done("close");
		if (matchesKey(data, Key.enter)) return this.done(actions[this.selected]!.action);
		if (matchesKey(data, Key.up) || data === "k") {
			this.selected = this.selected === 0 ? actions.length - 1 : this.selected - 1;
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.selected = this.selected === actions.length - 1 ? 0 : this.selected + 1;
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		const typed = stripAnsi(data).toLowerCase();
		const index = actions.findIndex((action) => action.key === typed);
		if (index >= 0) return this.done(actions[index]!.action);
	}

	render(width: number): string[] {
		const height = this.tui.terminal.rows || process.stdout.rows || 24;
		if (this.cachedLines && this.cachedWidth === width && this.cachedHeight === height) return this.cachedLines;

		const dim = (text: string) => this.theme.fg("dim", text);
		const accent = piBlue;
		const orange = piOrange;
		const muted = (text: string) => this.theme.fg("muted", text);

		const body: string[] = [];
		const logoLines = getLogoLines(this.config.logo ?? "pi");
		const logoWidth = Math.max(...logoLines.map((line) => visibleWidth(line)));
		for (const [i, line] of logoLines.entries()) {
			body.push(center(padRightVisible(colorLogoLine(line, i, logoLines.length), logoWidth), width));
		}
		const logoToMetaGap = height >= 44 ? 4 : 2;
		const metaToMenuGap = height >= 44 ? 5 : 3;
		const menuRowGap = height >= 44 ? 1 : 0;
		const menuToHelpGap = height >= 44 ? 4 : 2;

		if (this.config.showCwd) {
			body.push(...Array(logoToMetaGap).fill(""));
			body.push(center(muted(this.ctx.cwd), width));
			body.push(...Array(metaToMenuGap).fill(""));
		} else {
			body.push(...Array(height >= 44 ? 6 : 5).fill(""));
		}

		const labelWidth = Math.max(...actions.map((action) => visibleWidth(action.label)));
		const menuWidth = Math.min(width - 4, Math.max(44, labelWidth + 18));
		const menuPad = Math.max(0, Math.floor((width - menuWidth) / 2));

		for (let i = 0; i < actions.length; i++) {
			const item = actions[i]!;
			const selected = i === this.selected;
			const key = orange(item.key);
			const icon = accent(this.config.icons === false ? item.asciiIcon : item.icon);
			const label = accent(item.label);
			const prefix = selected ? accent("❯") : dim(" ");
			const left = padRightVisible(`${prefix}  ${icon}  ${label}`, menuWidth - 4);
			const row = `${left}${key}`;
			body.push(`${" ".repeat(menuPad)}${truncateToWidth(row, width - menuPad)}`);
			if (menuRowGap && i < actions.length - 1) body.push("");
		}

		body.push(...Array(menuToHelpGap).fill(""));
		body.push(center(dim("↑/↓ or j/k navigate  ·  enter select  ·  esc close"), width));

		const verticalOffset = height >= 44 ? 4 : 2;
		const topPad = Math.max(0, Math.floor((height - body.length) / 2) + verticalOffset);
		const lines = [...Array(topPad).fill(""), ...body];
		while (lines.length < height) lines.push("");

		this.cachedWidth = width;
		this.cachedHeight = height;
		this.cachedLines = lines.map((line) => {
			const truncated = truncateToWidth(line, width);
			return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
		});
		return this.cachedLines;
	}
}

async function showDashboard(ctx: ExtensionContext | ExtensionCommandContext): Promise<DashboardAction> {
	const config = loadConfig(ctx);
	return await ctx.ui.custom<DashboardAction>((tui, theme, _keybindings, done) => new AlphaDashboard(tui, theme, ctx, config, done), {
		overlay: true,
		overlayOptions: {
			width: "100%",
			maxHeight: "100%",
			anchor: "top-left",
			row: 0,
			col: 0,
			margin: 0,
		},
	});
}

async function openDashboardConfig(pi: ExtensionAPI, ctx: ExtensionContext | ExtensionCommandContext) {
	const editor = process.env.VISUAL || process.env.EDITOR || "nvim";
	const editorCommand = editor.split(/\s+/)[0] || editor;
	if (!(await commandAvailable(pi, editorCommand))) {
		ctx.ui.notify(`Could not find editor in PATH: ${editorCommand}`, "error");
		return;
	}
	const opened = await openTmuxWindow(pi, homedir(), "pi-greeter-config", `${editor} ${shellQuote(configPath)}`);
	ctx.ui.notify(opened ? "Opened dashboard config in a new tmux window" : `Run: ${editor} ${configPath}`, "info");
}

async function updatePi(pi: ExtensionAPI, ctx: ExtensionContext | ExtensionCommandContext) {
	if (!(await commandAvailable(pi, "pi"))) {
		ctx.ui.notify("Could not find the pi command in PATH", "error");
		return;
	}
	const confirmed = await ctx.ui.confirm("Update Pi?", "Run pi update now? This updates pi and all installed extensions.");
	if (!confirmed) return;
	ctx.ui.notify("Running pi update...", "info");
	// On timeout pi.exec kills the child and resolves with code 0 and killed: true, so code alone is not enough.
	const result = await pi.exec("pi", ["update"], { timeout: 600000 });
	const succeeded = result.code === 0 && !result.killed;
	const reason = result.killed ? "timed out" : result.stderr || result.stdout || `exit ${result.code}`;
	ctx.ui.notify(succeeded ? "pi update complete - restart pi to apply" : `pi update failed: ${reason}`, succeeded ? "info" : "error");
}

async function openLazygit(pi: ExtensionAPI, ctx: ExtensionContext | ExtensionCommandContext) {
	if (!(await commandAvailable(pi, "lazygit"))) {
		ctx.ui.notify("Could not find lazygit in PATH", "error");
		return;
	}
	const opened = await openTmuxWindow(pi, ctx.cwd, "lazygit", "lazygit");
	ctx.ui.notify(opened ? "Opened lazygit in a new tmux window" : "Run: lazygit", "info");
}

async function runAction(action: DashboardAction, pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	switch (action) {
		case "new":
			if (sessionIsEmpty(ctx)) return;
			await ctx.newSession();
			return;
		case "resume":
			ctx.ui.setEditorText("/resume");
			ctx.ui.notify("/resume is ready - press Enter to open Pi's session picker", "info");
			return;
		case "config":
			return openDashboardConfig(pi, ctx);
		case "update":
			return updatePi(pi, ctx);
		case "lazygit":
			return openLazygit(pi, ctx);
		case "quit":
			ctx.shutdown();
			return;
	}
}

export default function piGreeter(pi: ExtensionAPI) {
	let startupShown = false;

	pi.on("session_start", async (event, ctx) => {
		if (startupShown || event.reason !== "startup" || !ctx.hasUI) return;
		const config = loadConfig(ctx);
		if (config.showOnStartup === false) return;
		if (config.showOnStartup === "fresh" && !sessionIsEmpty(ctx)) return;
		startupShown = true;
		const action = await showDashboard(ctx);
		if (action === "quit") {
			ctx.shutdown();
			return;
		}

		// Important: from session_start we only have ExtensionContext, not
		// ExtensionCommandContext. Sending slash commands as user messages would go
		// to the LLM, not execute the command. So either run safe actions directly
		// or place command text in the editor for the user to submit.
		if (action === "config") return openDashboardConfig(pi, ctx);
		if (action === "update") return updatePi(pi, ctx);
		if (action === "lazygit") return openLazygit(pi, ctx);

		if (action === "new" && sessionIsEmpty(ctx)) return;

		const commandByAction: Partial<Record<DashboardAction, string>> = {
			new: "/new",
			resume: "/resume",
		};
		const command = commandByAction[action];
		if (command) {
			ctx.ui.setEditorText(command);
			ctx.ui.notify(`${command} is ready - press Enter to run it`, "info");
		}
	});


	pi.registerCommand("greeter", {
		description: "Open fullscreen Pi greeter",
		handler: async (_args, ctx) => {
			const action = await showDashboard(ctx);
			await runAction(action, pi, ctx);
		},
	});

	pi.registerCommand("pi-update", { description: "Run pi update", handler: async (_args, ctx) => updatePi(pi, ctx) });
}
