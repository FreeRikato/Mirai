use serde_json::{Value, json};
use tree_sitter::Language;
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

const FG: &str = "#ffffff";
const COMMENT: &str = "#6b6b6b";
const STRING: &str = "#a9d88a";
const NUMBER: &str = "#f4b63f";
const KEYWORD: &str = "#c49bff";
const FUNCTION: &str = "#7fa7ff";
const TYPE: &str = "#5fd0c8";
const PUNCTUATION: &str = "#9a9a9a";

const NAMES: &[(&str, &str)] = &[
    ("comment", COMMENT),
    ("string", STRING),
    ("string.special.key", FUNCTION),
    ("text.literal", STRING),
    ("text.uri", FUNCTION),
    ("text.title", FUNCTION),
    ("escape", NUMBER),
    ("number", NUMBER),
    ("boolean", NUMBER),
    ("constant.builtin", NUMBER),
    ("keyword", KEYWORD),
    ("import", KEYWORD),
    ("media", KEYWORD),
    ("keyframes", KEYWORD),
    ("supports", KEYWORD),
    ("charset", KEYWORD),
    ("function", FUNCTION),
    ("tag", FUNCTION),
    ("label", FUNCTION),
    ("constructor", TYPE),
    ("type", TYPE),
    ("attribute", TYPE),
    ("namespace", TYPE),
    ("operator", PUNCTUATION),
    ("punctuation", PUNCTUATION),
    ("variable.builtin", KEYWORD),
    ("property", FG),
    ("variable", FG),
    ("constant", FG),
    ("embedded", FG),
];

struct Grammar {
    language: Language,
    name: &'static str,
    highlights: String,
    locals: String,
}

fn grammar(path: &str) -> Option<Grammar> {
    let file = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    let ext = file.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let js = tree_sitter_javascript::HIGHLIGHT_QUERY;
    let jsx = tree_sitter_javascript::JSX_HIGHLIGHT_QUERY;
    let ts = tree_sitter_typescript::HIGHLIGHTS_QUERY;
    let ts_locals = format!("{}\n{}", tree_sitter_javascript::LOCALS_QUERY, tree_sitter_typescript::LOCALS_QUERY);
    let g = |language: Language, name, highlights: &str| Grammar { language, name, highlights: highlights.into(), locals: String::new() };
    Some(match ext {
        "ts" | "mts" | "cts" => Grammar { language: tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), name: "typescript", highlights: format!("{ts}\n{js}"), locals: ts_locals },
        "tsx" => Grammar { language: tree_sitter_typescript::LANGUAGE_TSX.into(), name: "tsx", highlights: format!("{ts}\n{jsx}\n{js}"), locals: ts_locals },
        "js" | "jsx" | "mjs" | "cjs" => Grammar { language: tree_sitter_javascript::LANGUAGE.into(), name: "javascript", highlights: format!("{jsx}\n{js}"), locals: tree_sitter_javascript::LOCALS_QUERY.into() },
        "py" | "pyi" => g(tree_sitter_python::LANGUAGE.into(), "python", tree_sitter_python::HIGHLIGHTS_QUERY),
        "json" | "jsonc" => g(tree_sitter_json::LANGUAGE.into(), "json", tree_sitter_json::HIGHLIGHTS_QUERY),
        "css" => g(tree_sitter_css::LANGUAGE.into(), "css", tree_sitter_css::HIGHLIGHTS_QUERY),
        "html" | "htm" => g(tree_sitter_html::LANGUAGE.into(), "html", tree_sitter_html::HIGHLIGHTS_QUERY),
        "sh" | "bash" | "zsh" => g(tree_sitter_bash::LANGUAGE.into(), "bash", tree_sitter_bash::HIGHLIGHT_QUERY),
        "rs" => g(tree_sitter_rust::LANGUAGE.into(), "rust", tree_sitter_rust::HIGHLIGHTS_QUERY),
        "go" => g(tree_sitter_go::LANGUAGE.into(), "go", tree_sitter_go::HIGHLIGHTS_QUERY),
        "yml" | "yaml" => g(tree_sitter_yaml::LANGUAGE.into(), "yaml", tree_sitter_yaml::HIGHLIGHTS_QUERY),
        "toml" => g(tree_sitter_toml_ng::LANGUAGE.into(), "toml", tree_sitter_toml_ng::HIGHLIGHTS_QUERY),
        "md" | "markdown" => g(tree_sitter_md::LANGUAGE.into(), "markdown", tree_sitter_md::HIGHLIGHT_QUERY_BLOCK),
        _ => return None,
    })
}

fn plain(text: &str) -> Value {
    json!(text.split('\n').map(|l| if l.is_empty() { vec![] } else { vec![json!([l, FG])] }).collect::<Vec<_>>())
}

pub fn highlight(path: &str, source: &str) -> Value {
    let text = source.replace("\r\n", "\n");
    let Some(g) = grammar(path) else { return plain(&text) };
    let Ok(mut cfg) = HighlightConfiguration::new(g.language, g.name, &g.highlights, "", &g.locals) else { return plain(&text) };
    let names: Vec<&str> = NAMES.iter().map(|(n, _)| *n).collect();
    cfg.configure(&names);
    let mut highlighter = Highlighter::new();
    let Ok(events) = highlighter.highlight(&cfg, text.as_bytes(), None, None, |_| None) else { return plain(&text) };
    let mut lines: Vec<Vec<(String, &str)>> = vec![Vec::new()];
    let mut stack: Vec<&str> = Vec::new();
    for event in events {
        let Ok(event) = event else { return plain(&text) };
        match event {
            HighlightEvent::HighlightStart(h) => stack.push(NAMES[h.0].1),
            HighlightEvent::HighlightEnd => {
                stack.pop();
            }
            HighlightEvent::Source { start, end } => {
                let color = stack.last().copied().unwrap_or(FG);
                for (i, part) in text[start..end].split('\n').enumerate() {
                    if i > 0 {
                        lines.push(Vec::new());
                    }
                    if part.is_empty() {
                        continue;
                    }
                    let line = lines.last_mut().expect("lines starts with one entry");
                    match line.last_mut() {
                        Some((t, c)) if *c == color => t.push_str(part),
                        _ => line.push((part.to_string(), color)),
                    }
                }
            }
        }
    }
    json!(lines.into_iter().map(|l| l.into_iter().map(|(t, c)| json!([t, c])).collect::<Vec<_>>()).collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(v: &Value) -> Vec<String> {
        v.as_array().unwrap().iter().map(|l| l.as_array().unwrap().iter().map(|t| t[0].as_str().unwrap()).collect()).collect()
    }

    fn color_of(v: &Value, line: usize, needle: &str) -> String {
        v[line].as_array().unwrap().iter().find(|t| t[0].as_str().unwrap().contains(needle)).map(|t| t[1].as_str().unwrap().to_string()).unwrap()
    }

    #[test]
    fn a_template_string_spanning_lines_stays_a_string() {
        let v = highlight("a.ts", "const msg = `first\nconst notCode = 1\n`;\nconst after = 2;");
        assert_eq!(color_of(&v, 1, "notCode"), STRING);
        assert_eq!(color_of(&v, 3, "const"), KEYWORD);
    }

    #[test]
    fn tokens_join_back_into_each_source_line() {
        let src = "def helper(x: int) -> int:\r\n    return x + 1  # bump\r\n";
        assert_eq!(joined(&highlight("util.py", src)), vec!["def helper(x: int) -> int:", "    return x + 1  # bump", ""]);
    }

    #[test]
    fn unknown_files_come_back_as_plain_text() {
        assert_eq!(highlight("notes.unknownext", "hello\n"), json!([[["hello", FG]], []]));
    }

    #[test]
    fn every_bundled_grammar_compiles_its_queries() {
        for path in ["a.ts", "a.tsx", "a.js", "a.py", "a.json", "a.css", "a.html", "a.sh", "a.rs", "a.go", "a.yaml", "a.toml", "a.md"] {
            let g = grammar(path).unwrap();
            assert!(HighlightConfiguration::new(g.language, g.name, &g.highlights, "", &g.locals).is_ok(), "{path}");
        }
    }
}
