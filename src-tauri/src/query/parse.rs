//! S-expression parser for [`super::Expr`].
//!
//! Hand-written recursive descent — small, zero-dep, good diagnostics.

use super::Expr;

type ParseResult<T> = Result<T, String>;

pub fn parse(input: &str) -> ParseResult<Expr> {
    let mut p = Parser::new(input);
    p.skip_ws();
    let expr = p.parse_expr()?;
    p.skip_ws();
    if p.pos < p.src.len() {
        return Err(format!("unexpected trailing input at offset {}", p.pos));
    }
    Ok(expr)
}

struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(s: &'a str) -> Self {
        Self { src: s.as_bytes(), pos: 0 }
    }

    fn peek(&self) -> Option<u8> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let c = self.peek()?;
        self.pos += 1;
        Some(c)
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_ascii_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn parse_expr(&mut self) -> ParseResult<Expr> {
        self.skip_ws();
        match self.peek() {
            Some(b'(') => {
                self.bump();
                self.parse_sexpr_body()
            }
            Some(b'[') => self.parse_page_ref(),
            Some(b'#') => self.parse_tag(),
            Some(b'"') => {
                let s = self.parse_string()?;
                Ok(Expr::Contains { words: vec![s] })
            }
            Some(_) => {
                // Bare token — treat as page ref (matches Logseq "query word").
                let tok = self.parse_bare_token()?;
                Ok(Expr::PageRef { name: tok })
            }
            None => Err("empty query".into()),
        }
    }

    fn parse_sexpr_body(&mut self) -> ParseResult<Expr> {
        self.skip_ws();
        let op = self.parse_bare_token()?;
        let op_lc = op.to_lowercase();
        let mut args: Vec<Expr> = Vec::new();
        let mut raw_args: Vec<String> = Vec::new();
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b')') => {
                    self.bump();
                    break;
                }
                None => return Err("unclosed '('".into()),
                Some(b'(') | Some(b'[') | Some(b'#') => {
                    args.push(self.parse_expr()?);
                }
                Some(b'"') => {
                    raw_args.push(self.parse_string()?);
                }
                _ => {
                    raw_args.push(self.parse_bare_token()?);
                }
            }
        }

        match op_lc.as_str() {
            "and" => {
                if args.is_empty() {
                    return Err("(and ...) needs sub-expressions".into());
                }
                Ok(Expr::And { children: args })
            }
            "or" => {
                if args.is_empty() {
                    return Err("(or ...) needs sub-expressions".into());
                }
                Ok(Expr::Or { children: args })
            }
            "not" => {
                if args.len() != 1 {
                    return Err("(not x) takes exactly one argument".into());
                }
                Ok(Expr::Not {
                    child: Box::new(args.into_iter().next().unwrap()),
                })
            }
            "page-ref" | "page" => {
                let name = single_name(&raw_args, &args, "page-ref")?;
                Ok(Expr::PageRef { name })
            }
            "tag" => {
                let tag = single_name(&raw_args, &args, "tag")?;
                Ok(Expr::Tag { tag })
            }
            "block-ref" | "block" => {
                let id = single_name(&raw_args, &args, "block-ref")?;
                Ok(Expr::BlockRef { id })
            }
            "contains" => {
                if raw_args.is_empty() {
                    return Err("(contains ...) needs at least one string".into());
                }
                Ok(Expr::Contains { words: raw_args })
            }
            "task" => {
                if raw_args.is_empty() {
                    return Err("(task ...) needs at least one marker".into());
                }
                Ok(Expr::Task { markers: raw_args })
            }
            other => Err(format!("unknown operator '{}'", other)),
        }
    }

    fn parse_page_ref(&mut self) -> ParseResult<Expr> {
        // Consumes `[[...]]`.
        if self.peek() != Some(b'[') || self.src.get(self.pos + 1).copied() != Some(b'[') {
            return Err("expected '[['".into());
        }
        self.pos += 2;
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == b']' && self.src.get(self.pos + 1).copied() == Some(b']') {
                let name = std::str::from_utf8(&self.src[start..self.pos])
                    .map_err(|_| "invalid utf-8 in page ref".to_string())?
                    .trim()
                    .to_string();
                self.pos += 2;
                return Ok(Expr::PageRef { name });
            }
            self.pos += 1;
        }
        Err("unclosed '[['".into())
    }

    fn parse_tag(&mut self) -> ParseResult<Expr> {
        if self.peek() != Some(b'#') {
            return Err("expected '#'".into());
        }
        self.pos += 1;
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_whitespace() || c == b')' || c == b'(' {
                break;
            }
            self.pos += 1;
        }
        if start == self.pos {
            return Err("empty tag".into());
        }
        let tag = std::str::from_utf8(&self.src[start..self.pos])
            .map_err(|_| "invalid utf-8 in tag".to_string())?
            .to_string();
        Ok(Expr::Tag { tag })
    }

    fn parse_string(&mut self) -> ParseResult<String> {
        if self.peek() != Some(b'"') {
            return Err("expected '\"'".into());
        }
        self.pos += 1;
        let mut out = String::new();
        while let Some(c) = self.bump() {
            match c {
                b'"' => return Ok(out),
                b'\\' => {
                    if let Some(n) = self.bump() {
                        out.push(n as char);
                    }
                }
                _ => out.push(c as char),
            }
        }
        Err("unclosed string literal".into())
    }

    fn parse_bare_token(&mut self) -> ParseResult<String> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_whitespace() || c == b'(' || c == b')' {
                break;
            }
            self.pos += 1;
        }
        if start == self.pos {
            return Err(format!("expected a token at offset {}", self.pos));
        }
        Ok(std::str::from_utf8(&self.src[start..self.pos])
            .map_err(|_| "invalid utf-8 in token".to_string())?
            .to_string())
    }
}

fn single_name(raw: &[String], exprs: &[Expr], op: &str) -> ParseResult<String> {
    if exprs.len() == 1 && raw.is_empty() {
        return Ok(match &exprs[0] {
            Expr::PageRef { name } => name.clone(),
            Expr::Tag { tag } => tag.clone(),
            Expr::BlockRef { id } => id.clone(),
            _ => return Err(format!("({op} ...) needs a name")),
        });
    }
    if raw.len() == 1 && exprs.is_empty() {
        return Ok(raw[0].clone());
    }
    Err(format!("({op} ...) takes exactly one argument"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_page_ref() {
        assert_eq!(parse("[[Hello World]]").unwrap(), Expr::PageRef { name: "Hello World".into() });
    }

    #[test]
    fn parses_and_mix() {
        let e = parse("(and [[a]] #b (not #c))").unwrap();
        match e {
            Expr::And { children } => assert_eq!(children.len(), 3),
            _ => panic!(),
        }
    }

    #[test]
    fn parses_task() {
        let e = parse("(task TODO DOING)").unwrap();
        assert_eq!(e, Expr::Task { markers: vec!["TODO".into(), "DOING".into()] });
    }

    #[test]
    fn parses_contains() {
        let e = parse(r#"(contains "hello world")"#).unwrap();
        assert_eq!(e, Expr::Contains { words: vec!["hello world".into()] });
    }
}
