---
title: "Validating translations in React with Rust - Part 1: CI validation"
description: "Here is a sample of some basic Markdown syntax that can be used when writing Markdown content in Astro."
pubDate: "Sep 03 2023"
heroImage: "/pnpm-translations.png"
---

I'm currently working on a React project that uses [react-intl](https://www.npmjs.com/package/react-intl) for translations. We have a lot of translations, and we're adding more every day. Our translation keys and values are manually entered into two JSON files: `en.json` and `sv.json` _(for English and Swedish, respectively)_.

![Translations in JSON files](/images/translations-example.png)

These translations are then used in our React components. Most of the time, we use the `<FormattedMessage />` component from `react-intl` to render the translations:

```jsx
import { FormattedMessage } from "react-intl";

const MyComponent = () => (
  <div>
    <FormattedMessage id="common.change_password" />
  </div>
);
```

# The problem

Unfortunately, it's easy to make mistakes when working like this. For example, you might forget to add a translation for a new string, or you might accidentally use a key that doesn't exist. These mistakes can be hard to catch, especially if you're working on a large project with many translations.

The biggest pain points for us are:

- **Missing translations:** A key is used in the code but there is no translation for it, resulting in the raw key being rendered to the user.
- **Unused translations:** A translation exists but is not used in the code, meaning it's just making the translation file messier and harder to maintain.
- **Key collisions:** Multiple translations have the same key, meaning that one of them will be overwritten by the other.
- **Mismatched files:** The keys in the English and Swedish translation files are not in sync, meaning that a key might exist in one file but not the other.

Finding these mistakes manually is tedious and error-prone. We need a way to automate this process. We need a way to validate our translations.

# Easing the pain

In order to solve these issues _(and build something interesting)_ I began building a tool that could validate our translations, locally and in the CI pipeline.

**Rust** is my language of choice for this project. Primarily because I enjoy working with Rust and have heard good things about the [clap](https://crates.io/crates/clap) crate for building command-line interfaces. But also due to the small binary size, great performance, and the fact that it's easy to compile to multiple platforms.

## Parsing arguments with clap

After installing clap with `cargo add clap --features derive`, you simply define a struct with the arguments you want to parse, and then call the `parse()` method on it:

```rust
/// Handle those damn translations...
#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Root directory to search from
    #[arg(short, long, default_value = ".")]
    root_dir: PathBuf,
    /// Path to English translation file
    #[arg(short, long)]
    en_file: PathBuf,
    /// Path to Swedish translation file
    #[arg(short, long)]
    sv_file: PathBuf,
}

fn main() {
    let args = Args::parse();

    println!("root_dir: {:?}", args.root_dir);
    println!("en_file: {:?}", args.en_file);
    println!("sv_file: {:?}", args.sv_file);
}
```

Here we are defining three arguments: `root_dir`, `en_file`, and `sv_file`. All three will be parsed as a `PathBuf`, which is a type provided by the standard library for working with file paths. The triple slash `///` comments is used to add documentation and help messages to the CLI.

The `root_dir` argument is optional and has a default value of `.` _(the current directory)_. The `en_file` and `sv_file` arguments are required, and all three arguments can be specified with either a short flag _(e.g. `-r`)_ or a long flag _(e.g. `--root-dir`)_.

This also gives us a nice help message when we run the program with the `--help` flag:

```bash
Handle those damn translations...

Usage: ramilang.exe [OPTIONS] --en-file <EN_FILE> --sv-file <SV_FILE>

Options:
  -r, --root-dir <ROOT_DIR>  Root directory to search from [default: .]
  -e, --en-file <EN_FILE>    Path to English translation file
  -s, --sv-file <SV_FILE>    Path to Swedish translation file
  -h, --help                 Print help
  -V, --version              Print version
```

## Reading the translation files

I created a `TranslationFile` struct to represent a translation file. It contains the path to the file, and a [BTreeMap](https://doc.rust-lang.org/std/collections/struct.BTreeMap.html) of the translation keys and values:

```rust
pub struct TranslationFile {
    pub path: PathBuf,
    pub entries: BTreeMap<String, String>,
}
```

The reason for using `BTreeMap`, a self-balancing tree data structure, is that it keeps the keys sorted without any additional work. Our translation files will now always be sorted alphabetically, making manual inspection easier. This means that writing the entries back to disk, sorted by keys, is as simple as this:

```rust
pub fn write(&self) -> Result<()> {
    let serialized_entries = serde_json::to_string_pretty(&self.entries)?;

    let mut file = File::create(&self.path)?;
    Ok(file.write_all(serialized_entries.as_bytes())?)
}
```

Creating a `TranslationFile` is as simple as providing a path to the file (`let translation_file = TranslationFile::new(path);`). The implementation of `new()` is a bit more involved, as it needs to read the file, parse the JSON, and check for duplicate keys:

```rust
impl TranslationFile {
    pub fn new(path: PathBuf) -> Result<Self, TranslationFileError> {
        let duplicates = find_key_duplicates(&path);
        if !duplicates.is_empty() {
            return Err(TranslationFileError::DuplicateKeys(path, duplicates));
        }

        let file = std::fs::File::open(&path).expect("Unable to open file");
        let entries = serde_json::from_reader(file).expect("Unable to parse json");

        Ok(Self { path, entries })
    }

    ...
}
```

I am not so happy with this implementation, as it reads the file twice. Once to check for duplicate keys inside `find_key_duplicates()`, and once inside `serde_json::from_reader()`. Looking for duplicates is validation logic that should probably not be part of the `new()` method.

## Checking compatibility between files

The `TranslationFile` struct also has a `check_compatibility()` method that checks if the keys in the file are compatible with another `TranslationFile`. This is used to check if the keys in the English and Swedish translation files are in sync:

```rust

```
