# test-control-protocol README

Naive syntax highlighting for Test Control Protocol (TCP) files for the Delphic LIS.

## Features

Primitive support based on existing Pathlab TCP's:

![Example of Highlighting](https://github.com/pl-jamesi/test-control-protocol/blob/master/tcp-highlighting-example.png?raw=true)

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

- In `<user home>/.vscode/extensions` folder `https://github.com/pl-jamesi/test-control-protocol.git` and restart Code.

## Known Issues

Highlights if line structure is more or less correct, but does not verify validity of instructions/keywords/macros.

## Contributing

All the magic happens in `syntaxes/testcontrolprotocol.tmLanguage.json` - this is the Text mate grammar file that is used for tokenization.

You may find the following resources useful:

https://www.youtube.com/watch?v=5msZv-nKebI

https://code.visualstudio.com/api/language-extensions/syntax-highlight-guidev

https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/light_vs.json

https://regexr.com/

## Development

- Make changes to `syntaxes/testcontrolprotocol.tmLanguage.json`
- Press `F5` to open a new window with the extension loaded.
- Create a new file with a file name suffix matching your language or otherwise manage file type association in .vscode/settings.json.
- Verify that syntax highlighting works.
- You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load saved changes.

## Add more language features

- I've ignored the below for now but it may be worthwhile.
- To add features such as intellisense, hovers and validators check out the VS Code extenders documentation at https://code.visualstudio.com/docs
