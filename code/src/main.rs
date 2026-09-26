mod highlight;

use std::io::Read;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some("highlight"), Some(path)) = (args.get(1).map(String::as_str), args.get(2)) else {
        eprintln!("usage: mirai-code highlight <path> < source");
        std::process::exit(2);
    };
    let mut src = String::new();
    if std::io::stdin().read_to_string(&mut src).is_err() {
        std::process::exit(1);
    }
    println!("{}", highlight::highlight(path, &src));
}
