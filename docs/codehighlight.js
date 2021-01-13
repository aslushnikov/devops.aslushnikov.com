import {} from './third-party/codemirror/runmode-standalone.js';

const importedModules = new Map();

export async function preloadHighlighter(mimeType) {
  if (!mimeType)
    return;
  const descriptor = codemirrorModes.find(d => d.mimeTypes.includes(mimeType));
  if (!descriptor)
    return [];
  const modes = new Set();
  collectDeps(descriptor.fileName, modes);
  for (const mode of modes) {
    let promise = importedModules.get(mode);
    if (!promise) {
      promise = import('./third-party/codemirror/' + mode);
      importedModules.set(mode, promise);
    }
    await promise;
  }

  function collectDeps(fileName, modes) {
    const d = codemirrorModes.find(d => d.fileName === fileName);
    for (const deps of (d.dependencies || []))
      collectDeps(deps, modes);
    modes.add(fileName);
  }
}

export async function highlightText(text, mimeType) {
  if (!mimeType)
    return [];
  await preloadHighlighter(mimeType);
  let line = [];
  const lines = [line];
  CodeMirror.runMode(text, mimeType, (tokenText, style, lineNumber, columnNumber) => {
    if (!tokenText.length)
      return;
    if (tokenText === '\n') {
      line = [];
      lines.push(line);
      return;
    }
    line.push({tokenText, className: style, columnNumber});
  });
  return lines;
}

const codemirrorModes = [
  {
    "fileName": "clike.js",
    "mimeTypes": [
      "text/x-csrc",
      "text/x-c",
      "text/x-chdr",
      "text/x-c++src",
      "text/x-c++hdr",
      "text/x-java",
      "text/x-csharp",
      "text/x-scala",
      "text/x-kotlin",
      "text/x-objectivec",
      "text/x-objectivec++",
      "x-shader/x-vertex",
      "x-shader/x-fragment"
    ]
  },
  {
    "fileName": "xml.js",
    "mimeTypes": [
      "text/xml",
    ]
  },
  {
    "fileName": "css.js",
    "mimeTypes": [
      "text/css",
      "text/x-scss",
      "text/x-gss",
    ]
  },
  {
    "fileName": "javascript.js",
    "mimeTypes": [
      "application/json",
      "text/javascript",
      "text/typescript",
    ]
  },
  {
    "fileName": "htmlmixed.js",
    "dependencies": [
      "javascript.js",
      "css.js",
      "xml.js",
    ],
    "mimeTypes": [
      "text/html",
    ]
  },
  {
    "fileName": "cmake.js",
    "mimeTypes": [
      "text/x-cmake"
    ]
  },
  {
    "fileName": "coffeescript.js",
    "mimeTypes": [
      "text/x-coffeescript"
    ]
  },
  {
    "fileName": "markdown.js",
    "dependencies": [
      'xml.js',
    ],
    "mimeTypes": [
        "text/markdown",
        "text/x-markdown"
    ]
  },
  {
    "fileName": "php.js",
    "dependencies": [
        "clike.js",
        "htmlmixed.js"
    ],
    "mimeTypes": [
        "application/x-httpd-php",
        "application/x-httpd-php-open",
        "text/x-php"
    ]
  },
  {
    "fileName": "python.js",
    "mimeTypes": [
        "text/x-python",
        "text/x-cython"
    ]
  },
  {
    "fileName": "shell.js",
    "mimeTypes": [
        "text/x-sh"
    ]
  },
  {
    "fileName": "livescript.js",
    "mimeTypes": [
        "text/x-livescript"
    ]
  },
  {
    "fileName": "clojure.js",
    "mimeTypes": [
        "text/x-clojure"
    ]
  },
  {
    "fileName": "jsx.js",
    "dependencies": [
      "javascript.js",
      "xml.js",
    ],
    "mimeTypes": [
        "text/jsx",
        "text/typescript-jsx"
    ]
  },
  {
    "fileName": "stylus.js",
    "mimeTypes": [
        "text/x-styl"
    ]
  },
  {
    "fileName": "webidl.js",
    "mimeTypes": [
        "text/x-webidl"
    ]
  }
];

