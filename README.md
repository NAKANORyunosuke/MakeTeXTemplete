# MakeTeXTemplete

VSCode explorer's folder context menu can generate LaTeX starter files for paper and slide projects.

## Commands

- `MakePaperTemplete`
- `MakeSlideTemplete`

Right-click a folder in the explorer and run one of the commands above. The extension creates:

- `.latexmkrc`
- `main.tex`

If a `.tex` file already exists, the extension keeps it and does not overwrite it.
Other existing files still ask before overwriting.

## Custom Template Config

Add this to `.vscode/settings.json` or your workspace `settings.json`:

```json
{
    "makeTeXTemplete.templateConfigPath": "./examples/template-config.json"
}
```

You can also put the template config directly in `settings.json`:

```json
{
    "makeTeXTemplete.templateConfig": {
        "paper": {
            "templateDirectory": "./templates/paper"
        },
        "slide": {
            "templateDirectory": "C:\\Users\\ryu_m\\workspace\\TeX\\talk\\template"
        }
    }
}
```

The distinction is important:

- In `settings.json`, put the config under `makeTeXTemplete.templateConfig`.
- In the external JSON loaded via `makeTeXTemplete.templateConfigPath`, the root object itself is the template config.
- Top-level `paper`, `slide`, `sharedAssets`, or `latexmkrc` entries in `settings.json` are ignored by this extension.

For most cases, folder copy is easier to manage. This is also supported:

```json
{
    "makeTeXTemplete.templateConfigPath": "./examples/folder-template-config.json"
}
```

With `templateDirectory`, every file under the template folder is copied into the folder you right-clicked:

```json
{
    "paper": {
        "templateDirectory": "./templates/paper"
    },
    "slide": {
        "templateDirectory": "./templates/slide"
    }
}
```

This mode is recommended when you want to keep PDFs, images, `.bib`, or subfolders together with the template.
Absolute paths are supported. When you use `templateConfigPath`, paths inside that JSON are resolved relative to the config file first, with workspace-relative fallback for compatibility.
If you use `makeTeXTemplete.templateConfig` instead, the same paths are resolved from the workspace folder.

The config file is JSON and can point to template files:

```json
{
    "sharedAssets": [
        {
            "sourcePath": "./assets/references.bib",
            "outputPath": "references.bib"
        }
    ],
    "latexmkrc": {
        "templatePath": "./templates/.latexmkrc"
    },
    "paper": {
        "templatePath": "./templates/paper-main.tex",
        "outputPath": "main.tex",
        "assets": [
            {
                "sourcePath": "./assets/sample-figure.pdf",
                "outputPath": "figures/sample-figure.pdf"
            }
        ]
    },
    "slide": {
        "templatePath": "./templates/slide-main.tex",
        "outputPath": "main.tex",
        "assets": [
            {
                "sourcePath": "./assets/logo.pdf",
                "outputPath": "assets/logo.pdf"
            }
        ]
    }
}
```

`templatePath` can be absolute or workspace-relative. If `makeTeXTemplete.templateConfigPath` is not set, built-in templates are used.
`sharedAssets` copies files for both commands, and `assets` under `paper` / `slide` copies files only for that template. PDF and other binary files are copied as-is.
When `templateDirectory` is set for `paper` or `slide`, that directory copy mode takes priority and the same section's `templatePath`, `outputPath`, and `assets` are not used.

## Development

1. Run `npm install`
2. Press `F5` in VSCode
3. In the Extension Development Host, right-click a folder in the explorer
