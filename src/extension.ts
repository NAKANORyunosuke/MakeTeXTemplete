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
    vscode.commands.registerCommand("makeTeXTemplete.makePaperTemplete", async (resource?: vscode.Uri) => {
      await generateTemplate(resource, "paper");
    }),
    vscode.commands.registerCommand("makeTeXTemplete.makeSlideTemplete", async (resource?: vscode.Uri) => {
      await generateTemplate(resource, "slide");
    })
  );
}

export function deactivate(): void {}

async function generateTemplate(resource: vscode.Uri | undefined, kind: TemplateKind): Promise<void> {
  try {
    const targetFolder = await resolveTargetFolder(resource);
    if (!targetFolder) {
      return;
    }

    const files = await buildOutputFiles(kind, targetFolder);
    const existingFiles = await findExistingFiles(targetFolder, files);
    if (existingFiles.length > 0) {
      const decision = await vscode.window.showWarningMessage(
        `${existingFiles.join(", ")} already exist in ${path.basename(targetFolder.fsPath)}.`,
        { modal: true },
        "Overwrite",
        "Cancel"
      );

      if (decision !== "Overwrite") {
        return;
      }
    }

    await Promise.all(
      files.map(async (file) => {
        const outputUri = resolveOutputUri(targetFolder, file.outputPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputUri.fsPath)));
        await vscode.workspace.fs.writeFile(outputUri, file.content);
      })
    );

    vscode.window.showInformationMessage(
      `${kind === "paper" ? "Paper" : "Slide"} template files were created in ${targetFolder.fsPath}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create template files: ${message}`);
  }
}

async function resolveTargetFolder(resource: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
  if (resource) {
    const stat = await vscode.workspace.fs.stat(resource);
    if (stat.type & vscode.FileType.Directory) {
      return resource;
    }
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No target folder was provided and no workspace folder is open.");
    return undefined;
  }

  return workspaceFolder.uri;
}

async function buildOutputFiles(kind: TemplateKind, targetFolder: vscode.Uri): Promise<OutputFile[]> {
  const templateConfig = await loadTemplateConfig(targetFolder);
  const sharedAssets = templateConfig?.sharedAssets ?? [];
  const templateFiles = await resolveTemplateOutputs(kind, targetFolder, templateConfig);
  const sharedAssetFiles = await Promise.all(sharedAssets.map((asset) => resolveAssetFile(targetFolder, asset)));

  const files = [...templateFiles, ...sharedAssetFiles];

  ensureUniqueOutputPaths(files);
  return files;
}

async function findExistingFiles(folder: vscode.Uri, files: OutputFile[]): Promise<string[]> {
  const checks = await Promise.all(
    files.map(async (file) => {
      try {
        await vscode.workspace.fs.stat(resolveOutputUri(folder, file.outputPath));
        return file.outputPath;
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
          return undefined;
        }

        throw error;
      }
    })
  );

  return checks.filter((value): value is string => value !== undefined);
}

async function loadTemplateConfig(targetFolder: vscode.Uri): Promise<TemplateConfigFile | undefined> {
  const configuredPath = vscode.workspace
    .getConfiguration(CONFIG_SECTION, targetFolder)
    .get<string>("templateConfigPath", "")
    .trim();

  if (!configuredPath) {
    return undefined;
  }

  const filePath = resolvePathFromWorkspace(targetFolder, configuredPath);
  const fileContent = await readUtf8File(filePath);

  try {
    return JSON.parse(fileContent) as TemplateConfigFile;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse template config file "${filePath}": ${reason}`);
  }
}

async function resolveTemplateFile(
  targetFolder: vscode.Uri,
  key: TemplateKey,
  source: TemplateSourceConfig | undefined,
  fallbackContent: string
): Promise<OutputFile> {
  const defaultOutputPath = key === "latexmkrc" ? ".latexmkrc" : "main.tex";
  const outputPath = source?.outputPath?.trim() || defaultOutputPath;

  if (!source?.templatePath?.trim()) {
    return {
      outputPath,
      content: Buffer.from(fallbackContent, "utf8")
    };
  }

  const templatePath = resolvePathFromWorkspace(targetFolder, source.templatePath);

  return {
    outputPath,
    content: await readFileBytes(templatePath)
  };
}

async function resolveTemplateOutputs(
  kind: TemplateKind,
  targetFolder: vscode.Uri,
  templateConfig: TemplateConfigFile | undefined
): Promise<OutputFile[]> {
  const source = templateConfig?.[kind];
  const templateDirectory = source?.templateDirectory?.trim();

  if (templateDirectory) {
    const directoryPath = resolvePathFromWorkspace(targetFolder, templateDirectory);
    return await readTemplateDirectory(directoryPath);
  }

  const kindAssets = source?.assets ?? [];

  return [
    await resolveTemplateFile(targetFolder, "latexmkrc", templateConfig?.latexmkrc, LATEXMKRC),
    await resolveTemplateFile(
      targetFolder,
      kind,
      source,
      kind === "paper" ? PAPER_MAIN_TEX : SLIDE_MAIN_TEX
    ),
    ...(await Promise.all(kindAssets.map((asset) => resolveAssetFile(targetFolder, asset))))
  ];
}

async function resolveAssetFile(targetFolder: vscode.Uri, asset: AssetSourceConfig): Promise<OutputFile> {
  const sourcePath = asset.sourcePath.trim();
  if (!sourcePath) {
    throw new Error("Asset sourcePath must not be empty.");
  }

  const resolvedSourcePath = resolvePathFromWorkspace(targetFolder, sourcePath);
  const outputPath = asset.outputPath?.trim() || path.basename(resolvedSourcePath);

  return {
    outputPath,
    content: await readFileBytes(resolvedSourcePath)
  };
}

async function readTemplateDirectory(directoryPath: string): Promise<OutputFile[]> {
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
  files: OutputFile[]
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
        content: await readFileBytes(childUri.fsPath)
      });
    }
  }
}

function resolvePathFromWorkspace(targetFolder: vscode.Uri, configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetFolder);
  const basePath = workspaceFolder?.uri.fsPath ?? targetFolder.fsPath;
  return path.resolve(basePath, configuredPath);
}

function resolveOutputUri(targetFolder: vscode.Uri, configuredPath: string): vscode.Uri {
  if (path.isAbsolute(configuredPath)) {
    throw new Error(`Output path must be relative to the target folder: "${configuredPath}"`);
  }

  const targetRoot = path.resolve(targetFolder.fsPath);
  const outputPath = path.resolve(targetRoot, configuredPath);
  const normalizedRoot = normalizeForComparison(ensureTrailingSeparator(targetRoot));
  const normalizedOutputPath = normalizeForComparison(outputPath);

  if (normalizedOutputPath !== normalizeForComparison(targetRoot) && !normalizedOutputPath.startsWith(normalizedRoot)) {
    throw new Error(`Output path escapes the target folder: "${configuredPath}"`);
  }

  return vscode.Uri.file(outputPath);
}

function ensureUniqueOutputPaths(files: readonly OutputFile[]): void {
  const seen = new Set<string>();

  for (const file of files) {
    const normalizedPath = normalizeForComparison(path.normalize(file.outputPath));
    if (seen.has(normalizedPath)) {
      throw new Error(`Duplicate output path detected: "${file.outputPath}"`);
    }

    seen.add(normalizedPath);
  }
}

function ensureTrailingSeparator(filePath: string): string {
  return filePath.endsWith(path.sep) ? filePath : `${filePath}${path.sep}`;
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

async function readDirectoryEntries(directoryUri: vscode.Uri): Promise<readonly [string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(directoryUri);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read directory "${directoryUri.fsPath}": ${reason}`);
  }
}
