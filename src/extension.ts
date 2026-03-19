import * as path from "path";
import * as vscode from "vscode";

type TemplateKind = "paper" | "slide";
type TemplateKey = "latexmkrc" | TemplateKind;

type OutputFile = {
    readonly outputPath: string;
    readonly content: Uint8Array;
};

type AssetSourceConfig = {
    readonly sourcePath: string;
    readonly outputPath?: string;
};

type TemplateSourceConfig = {
    readonly templateDirectory?: string;
    readonly templatePath?: string;
    readonly outputPath?: string;
    readonly assets?: readonly AssetSourceConfig[];
};

type TemplateConfigFile = {
    readonly sharedAssets?: readonly AssetSourceConfig[];
    readonly latexmkrc?: TemplateSourceConfig;
    readonly paper?: TemplateSourceConfig;
    readonly slide?: TemplateSourceConfig;
};

type ResolvedTemplateConfig = {
    readonly value?: TemplateConfigFile;
    readonly resolvePathCandidates: (
        configuredPath: string,
    ) => readonly string[];
};

const CONFIG_SECTION = "makeTeXTemplete";

const LATEXMKRC = String.raw`$latex = 'platex -synctex=1 -interaction=nonstopmode -file-line-error %O %S';
$bibtex = 'pbibtex %O %B';
$makeindex = 'mendex %O -o %D %S';
$dvipdf = 'dvipdfmx %O -o %D %S';
$pdf_mode = 3;
$max_repeat = 5;
`;

const PAPER_MAIN_TEX = String.raw`\documentclass[a4paper,11pt]{jsarticle}

\usepackage[dvipdfmx]{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{bm}
\usepackage{hyperref}

\title{Paper Title}
\author{Author Name}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Write your paper here.

\section{Conclusion}

Summarize the main points here.

\end{document}
`;

const SLIDE_MAIN_TEX = String.raw`\documentclass[dvipdfmx,11pt]{beamer}

\usetheme{Madrid}
\usecolortheme{default}
\setbeamertemplate{navigation symbols}{}

\title{Slide Title}
\author{Author Name}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Overview}
  \tableofcontents
\end{frame}

\section{Introduction}

\begin{frame}{Introduction}
  \begin{itemize}
    \item Point 1
    \item Point 2
  \end{itemize}
\end{frame}

\section{Summary}

\begin{frame}{Summary}
  \begin{itemize}
    \item Key takeaway
  \end{itemize}
\end{frame}

\end{document}
`;

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "makeTeXTemplete.makePaperTemplete",
            async (resource?: vscode.Uri) => {
                await generateTemplate(resource, "paper");
            },
        ),
        vscode.commands.registerCommand(
            "makeTeXTemplete.makeSlideTemplete",
            async (resource?: vscode.Uri) => {
                await generateTemplate(resource, "slide");
            },
        ),
    );
}

export function deactivate(): void {}

async function generateTemplate(
    resource: vscode.Uri | undefined,
    kind: TemplateKind,
): Promise<void> {
    try {
        const targetFolder = await resolveTargetFolder(resource);
        if (!targetFolder) {
            return;
        }

        const files = await buildOutputFiles(kind, targetFolder);
        const existingFiles = await findExistingFiles(targetFolder, files);
        const existingTexFiles = existingFiles.filter((filePath) =>
            isTexOutputPath(filePath),
        );
        const existingNonTexFiles = existingFiles.filter(
            (filePath) => !isTexOutputPath(filePath),
        );

        if (existingNonTexFiles.length > 0) {
            const message =
                existingTexFiles.length > 0
                    ? `${existingNonTexFiles.join(", ")} already exist in ${path.basename(targetFolder.fsPath)}. Existing .tex files will be kept.`
                    : `${existingNonTexFiles.join(", ")} already exist in ${path.basename(targetFolder.fsPath)}.`;
            const decision = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                "Overwrite",
                "Cancel",
            );

            if (decision !== "Overwrite") {
                return;
            }
        }

        const protectedTexPaths = new Set(
            existingTexFiles.map((filePath) => normalizeOutputPath(filePath)),
        );
        const filesToWrite = files.filter(
            (file) => !protectedTexPaths.has(normalizeOutputPath(file.outputPath)),
        );

        await Promise.all(
            filesToWrite.map(async (file) => {
                const outputUri = resolveOutputUri(
                    targetFolder,
                    file.outputPath,
                );
                await vscode.workspace.fs.createDirectory(
                    vscode.Uri.file(path.dirname(outputUri.fsPath)),
                );
                await vscode.workspace.fs.writeFile(outputUri, file.content);
            }),
        );

        vscode.window.showInformationMessage(
            buildCompletionMessage(
                kind,
                targetFolder,
                filesToWrite.length,
                existingTexFiles,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
            `Failed to create template files: ${message}`,
        );
    }
}

async function resolveTargetFolder(
    resource: vscode.Uri | undefined,
): Promise<vscode.Uri | undefined> {
    if (resource) {
        const stat = await vscode.workspace.fs.stat(resource);
        if (stat.type & vscode.FileType.Directory) {
            return resource;
        }
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage(
            "No target folder was provided and no workspace folder is open.",
        );
        return undefined;
    }

    return workspaceFolder.uri;
}

async function buildOutputFiles(
    kind: TemplateKind,
    targetFolder: vscode.Uri,
): Promise<OutputFile[]> {
    const templateConfig = await loadTemplateConfig(targetFolder);
    const sharedAssets = templateConfig.value?.sharedAssets ?? [];
    const templateFiles = await resolveTemplateOutputs(kind, templateConfig);
    const sharedAssetFiles = await Promise.all(
        sharedAssets.map((asset) => resolveAssetFile(templateConfig, asset)),
    );

    const files = [...templateFiles, ...sharedAssetFiles];

    ensureUniqueOutputPaths(files);
    return files;
}

async function findExistingFiles(
    folder: vscode.Uri,
    files: OutputFile[],
): Promise<string[]> {
    const checks = await Promise.all(
        files.map(async (file) => {
            try {
                await vscode.workspace.fs.stat(
                    resolveOutputUri(folder, file.outputPath),
                );
                return file.outputPath;
            } catch (error) {
                if (
                    error instanceof vscode.FileSystemError &&
                    error.code === "FileNotFound"
                ) {
                    return undefined;
                }

                throw error;
            }
        }),
    );

    return checks.filter((value): value is string => value !== undefined);
}

async function loadTemplateConfig(
    targetFolder: vscode.Uri,
): Promise<ResolvedTemplateConfig> {
    const configuration = vscode.workspace.getConfiguration(
        CONFIG_SECTION,
        targetFolder,
    );
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetFolder);
    const workspaceBasePath =
        workspaceFolder?.uri.fsPath ?? targetFolder.fsPath;
    const inlineConfig = configuration.get<TemplateConfigFile | null>(
        "templateConfig",
        null,
    );

    if (inlineConfig && typeof inlineConfig === "object") {
        return {
            value: inlineConfig,
            resolvePathCandidates: (configuredPath) =>
                buildPathCandidates(workspaceBasePath, configuredPath),
        };
    }

    const configuredPath = configuration
        .get<string>("templateConfigPath", "")
        .trim();
    if (!configuredPath) {
        return {
            value: undefined,
            resolvePathCandidates: (pathToResolve) =>
                buildPathCandidates(workspaceBasePath, pathToResolve),
        };
    }

    const filePath = resolvePathFromBase(workspaceBasePath, configuredPath);
    const fileContent = await readUtf8File(filePath);

    try {
        return {
            value: JSON.parse(fileContent) as TemplateConfigFile,
            resolvePathCandidates: (pathToResolve) =>
                buildPathCandidates(
                    path.dirname(filePath),
                    pathToResolve,
                    workspaceBasePath,
                ),
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Could not parse template config file "${filePath}": ${reason}`,
        );
    }
}

async function resolveTemplateFile(
    templateConfig: ResolvedTemplateConfig,
    key: TemplateKey,
    source: TemplateSourceConfig | undefined,
    fallbackContent: string,
): Promise<OutputFile> {
    const defaultOutputPath = key === "latexmkrc" ? ".latexmkrc" : "main.tex";
    const outputPath = source?.outputPath?.trim() || defaultOutputPath;

    if (!source?.templatePath?.trim()) {
        return {
            outputPath,
            content: Buffer.from(fallbackContent, "utf8"),
        };
    }

    const templatePath = await resolveConfiguredPath(
        templateConfig,
        source.templatePath,
        vscode.FileType.File,
        "file",
    );

    return {
        outputPath,
        content: await readFileBytes(templatePath),
    };
}

async function resolveTemplateOutputs(
    kind: TemplateKind,
    templateConfig: ResolvedTemplateConfig,
): Promise<OutputFile[]> {
    const source = templateConfig.value?.[kind];
    const templateDirectory = source?.templateDirectory?.trim();

    if (templateDirectory) {
        const directoryPath = await resolveConfiguredPath(
            templateConfig,
            templateDirectory,
            vscode.FileType.Directory,
            "directory",
        );
        return await readTemplateDirectory(directoryPath);
    }

    const kindAssets = source?.assets ?? [];

    return [
        await resolveTemplateFile(
            templateConfig,
            "latexmkrc",
            templateConfig.value?.latexmkrc,
            LATEXMKRC,
        ),
        await resolveTemplateFile(
            templateConfig,
            kind,
            source,
            kind === "paper" ? PAPER_MAIN_TEX : SLIDE_MAIN_TEX,
        ),
        ...(await Promise.all(
            kindAssets.map((asset) => resolveAssetFile(templateConfig, asset)),
        )),
    ];
}

async function resolveAssetFile(
    templateConfig: ResolvedTemplateConfig,
    asset: AssetSourceConfig,
): Promise<OutputFile> {
    const sourcePath = asset.sourcePath.trim();
    if (!sourcePath) {
        throw new Error("Asset sourcePath must not be empty.");
    }

    const resolvedSourcePath = await resolveConfiguredPath(
        templateConfig,
        sourcePath,
        vscode.FileType.File,
        "file",
    );
    const outputPath =
        asset.outputPath?.trim() || path.basename(resolvedSourcePath);

    return {
        outputPath,
        content: await readFileBytes(resolvedSourcePath),
    };
}

async function readTemplateDirectory(
    directoryPath: string,
): Promise<OutputFile[]> {
    const rootUri = vscode.Uri.file(directoryPath);
    const rootEntries = await readDirectoryEntries(rootUri);
    const files: OutputFile[] = [];

    await collectDirectoryFiles(rootUri, rootUri, rootEntries, files);
    return files;
}

async function collectDirectoryFiles(
    rootUri: vscode.Uri,
    currentUri: vscode.Uri,
    entries: readonly [string, vscode.FileType][],
    files: OutputFile[],
): Promise<void> {
    for (const [name, type] of entries) {
        const childUri = vscode.Uri.joinPath(currentUri, name);

        if (type & vscode.FileType.Directory) {
            const childEntries = await readDirectoryEntries(childUri);
            await collectDirectoryFiles(rootUri, childUri, childEntries, files);
            continue;
        }

        if (type & vscode.FileType.File) {
            files.push({
                outputPath: path.relative(rootUri.fsPath, childUri.fsPath),
                content: await readFileBytes(childUri.fsPath),
            });
        }
    }
}

function buildPathCandidates(
    primaryBasePath: string,
    configuredPath: string,
    fallbackBasePath?: string,
): readonly string[] {
    if (path.isAbsolute(configuredPath)) {
        return [configuredPath];
    }

    const candidates = [path.resolve(primaryBasePath, configuredPath)];
    if (fallbackBasePath) {
        candidates.push(path.resolve(fallbackBasePath, configuredPath));
    }

    const seen = new Set<string>();
    const uniqueCandidates: string[] = [];

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeForComparison(
            path.normalize(candidate),
        );
        if (seen.has(normalizedCandidate)) {
            continue;
        }

        seen.add(normalizedCandidate);
        uniqueCandidates.push(candidate);
    }

    return uniqueCandidates;
}

function resolvePathFromBase(basePath: string, configuredPath: string): string {
    if (path.isAbsolute(configuredPath)) {
        return configuredPath;
    }

    return path.resolve(basePath, configuredPath);
}

async function resolveConfiguredPath(
    templateConfig: ResolvedTemplateConfig,
    configuredPath: string,
    expectedType: vscode.FileType,
    kind: "file" | "directory",
): Promise<string> {
    const candidates = templateConfig.resolvePathCandidates(configuredPath);
    let lastError: unknown;

    for (const candidate of candidates) {
        try {
            const stat = await vscode.workspace.fs.stat(
                vscode.Uri.file(candidate),
            );
            if (stat.type & expectedType) {
                return candidate;
            }

            lastError = new Error(
                `Path exists but is not a ${kind}: "${candidate}"`,
            );
        } catch (error) {
            lastError = error;
        }
    }

    const reason =
        lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
        `Could not resolve ${kind} path "${configuredPath}". Tried: ${candidates
            .map((candidate) => `"${candidate}"`)
            .join(", ")}. ${reason}`,
    );
}

function resolveOutputUri(
    targetFolder: vscode.Uri,
    configuredPath: string,
): vscode.Uri {
    if (path.isAbsolute(configuredPath)) {
        throw new Error(
            `Output path must be relative to the target folder: "${configuredPath}"`,
        );
    }

    const targetRoot = path.resolve(targetFolder.fsPath);
    const outputPath = path.resolve(targetRoot, configuredPath);
    const normalizedRoot = normalizeForComparison(
        ensureTrailingSeparator(targetRoot),
    );
    const normalizedOutputPath = normalizeForComparison(outputPath);

    if (
        normalizedOutputPath !== normalizeForComparison(targetRoot) &&
        !normalizedOutputPath.startsWith(normalizedRoot)
    ) {
        throw new Error(
            `Output path escapes the target folder: "${configuredPath}"`,
        );
    }

    return vscode.Uri.file(outputPath);
}

function ensureUniqueOutputPaths(files: readonly OutputFile[]): void {
    const seen = new Set<string>();

    for (const file of files) {
        const normalizedPath = normalizeOutputPath(file.outputPath);
        if (seen.has(normalizedPath)) {
            throw new Error(
                `Duplicate output path detected: "${file.outputPath}"`,
            );
        }

        seen.add(normalizedPath);
    }
}

function buildCompletionMessage(
    kind: TemplateKind,
    targetFolder: vscode.Uri,
    writtenFileCount: number,
    skippedTexFiles: readonly string[],
): string {
    const templateLabel = kind === "paper" ? "Paper" : "Slide";
    const skippedSuffix =
        skippedTexFiles.length > 0
            ? ` Existing .tex files were kept: ${skippedTexFiles.join(", ")}.`
            : "";

    if (writtenFileCount === 0) {
        return `No ${templateLabel.toLowerCase()} template files were written in ${targetFolder.fsPath}.${skippedSuffix}`;
    }

    return `${templateLabel} template files were created in ${targetFolder.fsPath}.${skippedSuffix}`;
}

function ensureTrailingSeparator(filePath: string): string {
    return filePath.endsWith(path.sep) ? filePath : `${filePath}${path.sep}`;
}

function isTexOutputPath(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === ".tex";
}

function normalizeOutputPath(filePath: string): string {
    return normalizeForComparison(path.normalize(filePath));
}

function normalizeForComparison(filePath: string): string {
    return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

async function readUtf8File(filePath: string): Promise<string> {
    const content = await readFileBytes(filePath);
    return Buffer.from(content).toString("utf8");
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
    try {
        return await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read file "${filePath}": ${reason}`);
    }
}

async function readDirectoryEntries(
    directoryUri: vscode.Uri,
): Promise<readonly [string, vscode.FileType][]> {
    try {
        return await vscode.workspace.fs.readDirectory(directoryUri);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Could not read directory "${directoryUri.fsPath}": ${reason}`,
        );
    }
}
