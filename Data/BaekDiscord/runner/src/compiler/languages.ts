import { spawnSync } from "node:child_process";
import type { LanguageInfo } from "../protocol.js";
import { isWindows } from "../config.js";

export interface LanguageDef {
  id: string;
  label: string;
  extension: string;
  fileName: string;
  /** Binary used to probe availability and read a version string. */
  probe: { file: string; args: string[] };
  /** Compile step (null = interpreted). {src}, {out}, {dir} are substituted. */
  compile: { file: string; args: string[] } | null;
  run: { file: string; args: string[] };
  template: string;
}

const exe = (name: string) => (isWindows ? `${name}.exe` : name);

export const LANGUAGES: LanguageDef[] = [
  {
    id: "c",
    label: "C (gcc, C17)",
    extension: "c",
    fileName: "main.c",
    probe: { file: "gcc", args: ["--version"] },
    compile: { file: "gcc", args: ["-O2", "-std=c17", "-Wall", "{src}", "-o", "{out}", "-lm"] },
    run: { file: "{out}", args: [] },
    template: [
      "#include <stdio.h>",
      "",
      "int main(void) {",
      "    int a, b;",
      "    if (scanf(\"%d %d\", &a, &b) == 2) printf(\"%d\\n\", a + b);",
      "    return 0;",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "cpp",
    label: "C++ (g++, C++17)",
    extension: "cpp",
    fileName: "main.cpp",
    probe: { file: "g++", args: ["--version"] },
    compile: { file: "g++", args: ["-O2", "-std=c++17", "-Wall", "{src}", "-o", "{out}"] },
    run: { file: "{out}", args: [] },
    template: [
      "#include <bits/stdc++.h>",
      "using namespace std;",
      "",
      "int main() {",
      "    ios::sync_with_stdio(false);",
      "    cin.tie(nullptr);",
      "    long long a, b;",
      "    if (cin >> a >> b) cout << a + b << \"\\n\";",
      "    return 0;",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "python",
    label: "Python 3",
    extension: "py",
    fileName: "main.py",
    probe: { file: "python", args: ["--version"] },
    compile: null,
    run: { file: "python", args: ["{src}"] },
    template: [
      "import sys",
      "",
      "def main():",
      "    data = sys.stdin.read().split()",
      "    if len(data) >= 2:",
      "        print(int(data[0]) + int(data[1]))",
      "",
      "main()",
      "",
    ].join("\n"),
  },
  {
    id: "java",
    label: "Java (class Main)",
    extension: "java",
    fileName: "Main.java",
    probe: { file: "javac", args: ["-version"] },
    compile: { file: "javac", args: ["-encoding", "UTF-8", "{src}"] },
    run: { file: "java", args: ["-Xss64m", "-cp", "{dir}", "Main"] },
    template: [
      "import java.io.*;",
      "import java.util.*;",
      "",
      "public class Main {",
      "    public static void main(String[] args) throws IOException {",
      "        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));",
      "        StringTokenizer st = new StringTokenizer(br.readLine());",
      "        long a = Long.parseLong(st.nextToken());",
      "        long b = Long.parseLong(st.nextToken());",
      "        System.out.println(a + b);",
      "    }",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "javascript",
    label: "JavaScript (Node)",
    extension: "js",
    fileName: "main.js",
    probe: { file: "node", args: ["--version"] },
    compile: null,
    run: { file: "node", args: ["{src}"] },
    template: [
      "const input = require(\"fs\").readFileSync(0, \"utf8\").trim().split(/\\s+/);",
      "const [a, b] = input.map(Number);",
      "console.log(a + b);",
      "",
    ].join("\n"),
  },
  {
    id: "typescript",
    label: "TypeScript (Node strip-types)",
    extension: "ts",
    fileName: "main.ts",
    probe: { file: "node", args: ["--version"] },
    compile: null,
    run: { file: "node", args: ["--experimental-strip-types", "--no-warnings", "{src}"] },
    template: [
      "import { readFileSync } from \"node:fs\";",
      "",
      "const input: string[] = readFileSync(0, \"utf8\").trim().split(/\\s+/);",
      "const [a, b] = input.map(Number);",
      "console.log(a + b);",
      "",
    ].join("\n"),
  },
  {
    id: "rust",
    label: "Rust (rustc)",
    extension: "rs",
    fileName: "main.rs",
    probe: { file: "rustc", args: ["--version"] },
    compile: { file: "rustc", args: ["-O", "{src}", "-o", "{out}"] },
    run: { file: "{out}", args: [] },
    template: [
      "use std::io::{self, Read};",
      "",
      "fn main() {",
      "    let mut s = String::new();",
      "    io::stdin().read_to_string(&mut s).unwrap();",
      "    let v: Vec<i64> = s.split_whitespace().map(|x| x.parse().unwrap()).collect();",
      "    println!(\"{}\", v[0] + v[1]);",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "go",
    label: "Go",
    extension: "go",
    fileName: "main.go",
    probe: { file: "go", args: ["version"] },
    compile: { file: "go", args: ["build", "-o", "{out}", "{src}"] },
    run: { file: "{out}", args: [] },
    template: [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func main() {",
      "    var a, b int64",
      "    fmt.Scan(&a, &b)",
      "    fmt.Println(a + b)",
      "}",
      "",
    ].join("\n"),
  },
];

interface Probe {
  available: boolean;
  version: string | null;
}

const probeCache = new Map<string, Probe>();

export function probeLanguage(def: LanguageDef): Probe {
  const cached = probeCache.get(def.id);
  if (cached) return cached;
  let result: Probe = { available: false, version: null };
  try {
    const r = spawnSync(def.probe.file, def.probe.args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (r.status === 0) {
      const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/)[0] ?? "";
      result = { available: true, version: text.slice(0, 80) || null };
    }
  } catch {
    /* unavailable */
  }
  probeCache.set(def.id, result);
  return result;
}

export function languageInfos(): LanguageInfo[] {
  return LANGUAGES.map((def) => {
    const p = probeLanguage(def);
    return {
      id: def.id,
      label: def.label,
      extension: def.extension,
      fileName: def.fileName,
      available: p.available,
      version: p.version,
      template: def.template,
    };
  });
}

export function findLanguage(id: string): LanguageDef | undefined {
  return LANGUAGES.find((l) => l.id === id);
}

export function outputBinaryName(): string {
  return exe("main");
}
