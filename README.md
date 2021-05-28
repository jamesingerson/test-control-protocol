# test-control-protocol README

Naive syntax highlighting for Test Control Protocol (TCP) files for the Delphic LIS.

## Features

Primitive support based on existing Pathlab TCP's:

<img src="https://github.com/pl-jamesi/test-control-protocol/blob/master/images/tcp-highlighting-example.png?raw=true" alt="Example TCP Highlighting" width="600px" />

Also has folding:

<img src="https://github.com/pl-jamesi/test-control-protocol/blob/master/images/collapse-tcp.gif?raw=true" alt="Example TCP Folding" width="800px" />

## Requirements

Pathlab TCP files do not have an extension, so you need to declare the file type association in VS Code yourself:

In the directory where you're working, if it does not already exist create a .vscode folder, within that, settings.json.

```
{
  "editor.rulers": [7, 18, 27, 36, 45, 54, 80],
  "workbench.colorCustomizations": {
    "editorRuler.foreground": "#424242"
  },
  "files.associations": {
    "**/testlisv10-tcp/**/*.gitignore": "txt",
    "**/testlisv10-tcp/**/TCP_LIST*": "shellscript",
    "**/testlisv10-tcp/**/*.json": "json",
    "**/testlisv10-tcp/**/*": "testcontrolprotocol"
  }
}
```

(Rulers are optional.)

## Installation

- In `<user home>/.vscode/extensions` folder `git clone https://github.com/pl-jamesi/test-control-protocol.git` and restart VS Code.

## Known Issues

- Highlights if line structure is more or less correct, but does not verify the validity of instructions/keywords/macros/globals.
- Assumed line numbers will be systemically removed in the future, so they are not validated or coloured.
- Missing support for EOL comments as their validity is unclear, should probably be moved to their own lines.
- Some instructions should have more intelligent highlighting, e.g. NORMAL's first operand is a reference range so the colours should match.

## Contributing

All the magic happens in `syntaxes/testcontrolprotocol.tmLanguage.json` the Text mate grammar file that is used for tokenization.

You may find the following resources useful:

https://www.youtube.com/watch?v=5msZv-nKebI - walkthrough of someone else going through the experience of setting up syntax highlighting for their own language.

https://regexr.com/ - for testing regular expressions. Note, in .tmLanguage.json you have to double escape using \\, but regexr should only have one \ to escape something.

https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide - written instructions on set up and behaviour of VS Code syntax highlighting.

https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/light_vs.json - for examples of "names" to use for colouring.

## Development

- Make changes to `syntaxes/testcontrolprotocol.tmLanguage.json`
- Press `F5` to open a new window with the extension loaded.
- Create a new file with a file name suffix matching your language or otherwise manage file type association in .vscode/settings.json.
- Verify that syntax highlighting works.
- You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load saved changes.

## Add more language features

- There's documentation on intellisense, hovers, and validators, etc at VS Code extenders documentation at https://code.visualstudio.com/docs
- I've not implemented any of it at this time but it may be worthwhile.
