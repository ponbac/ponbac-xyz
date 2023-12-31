---
title: "Validating translations in React with Rust - Part 1: CLI tool"
description: "Solving the problem of missing and unused translations in React with a tool built in Rust."
pubDate: "Sep 11 2023"
heroImage: "/images/translations-1-hero.webp"
---

I'm currently working on a React project that uses [react-intl](https://www.npmjs.com/package/react-intl) for translations. We have a lot of translations, and we're adding more every day. Our translation keys and values are manually entered into two JSON files: `en.json` and `sv.json` _(for English and Swedish, respectively)_.

![Translations in JSON files](../../assets/images/translation-tool/translations-example.webp)

These translations are then used in our React components. Most of the time, we use the `<FormattedMessage />` component from `react-intl` to render the translations:

```jsx
import { FormattedMessage } from "react-intl";

const MyComponent = () => (
  <div>
    <FormattedMessage id="common.change_password" />
  </div>
);
```

Unfortunately, it's easy to make mistakes when working like this. For example, you might forget to add a translation for a new string, or you might accidentally use a key that doesn't exist. These mistakes can be hard to catch, especially if you're working on a large project with many translations.

The biggest pain points for us are:

- **Missing translations:** A key is used in the code but there is no translation for it, resulting in the raw key being rendered to the user.
- **Unused translations:** A translation exists but is not used in the code, meaning it's just making the translation file messier and harder to maintain.
- **Key collisions:** Multiple translations have the same key, meaning that one of them will be overwritten by the other.
- **Mismatched files:** The keys in the English and Swedish translation files are not in sync, meaning that a key might exist in one file but not the other.

Finding these mistakes manually is tedious and error-prone. We need a way to automate this process. We need a way to validate our translations.

## Table of contents

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

Creating a `TranslationFile` is done by providing a path to the file (`let translation_file = TranslationFile::new(path);`). The implementation of `new()` is a bit more involved, as it needs to read the file, parse the JSON, and check for duplicate keys:

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

I am not satisfied with this implementation, as it reads the file twice. Once to check for duplicate keys inside `find_key_duplicates()`, and once inside `serde_json::from_reader()`.

Another issue is that I am looking for duplicates here. This is validation logic that should probably not be part of the `new()` method.

## Checking compatibility between files

The `TranslationFile` struct also has a `is_compatible_with()` method that checks if the keys in the file are compatible with another `TranslationFile`. This is used to check if the keys in the English and Swedish translation files are in sync and that no keys have empty values:

```rust
/// Compare two translation files and return an error if they are not compatible.
///
/// Two translation files are compatible if:
/// - They have the same keys
/// - All keys have a non-empty value
pub fn is_compatible_with(
    &self,
    other: &Self,
) -> Result<(), (Vec<TranslationFileError>, Vec<TranslationFileError>)> {
    let self_errors = self.check_rules(other);
    let other_errors = other.check_rules(self);

    if !self_errors.is_empty() || !other_errors.is_empty() {
        return Err((self_errors, other_errors));
    }

    Ok(())
}

fn check_rules(&self, other: &Self) -> Vec<TranslationFileError> {
    let mut errors = Vec::new();

    for (key, value) in &self.entries {
        // Check matching keys
        if !other.entries.contains_key(key) {
            errors.push(TranslationFileError::MissingKey {
                key: key.clone(),
                missing_in: other.path.clone(),
            });
        // Check non-empty values
        } else if value.is_empty() {
            errors.push(TranslationFileError::EmptyValue(key.to_string()));
        }
    }

    errors
}
```

I would like to improve the rules checking here, as it's not very flexible. For example, it would be nice to be able to specify a list of rules to check _(probably in the form of functions that return a `TranslationFileError`)_, and then have the `check_rules()` method iterate over that list and check each rule.

## Walking the directory tree

The last piece of the puzzle is finding all the places where a translation key is used in the code. In order to do this, we first need to identify all the files that could contain translations.

This is done with the help of the [walkdir](https://crates.io/crates/walkdir) crate, which provides an iterator over all the files in a directory tree:

```rust
fn is_node_modules(entry: &DirEntry) -> bool {
    entry.file_name() == "node_modules"
}

let walker = WalkDir::new(args.root_dir)
    .into_iter()
    // Exclude node_modules
    .filter_entry(|e| !is_node_modules(e))
    // Filter out any non-accessible files
    .filter_map(|e| e.ok());
```

As can be seen above, we are filtering out the `node_modules` directory, as we don't want to check any files in there. The `filter_entry()` function makes the walker not descend into the filtered directories, thereby potentially saving us quite a bit of time _(`node_modules` often contains a ridiculous amount of files and directories)_.

We are also filtering out any files that we don't have access to _(e.g. due to permissions)_. This is done with the `filter_map()` function, which allows us to filter and map at the same time. The `ok()` function converts a `Result` into an `Option`, turning errors into `None`, which results in them getting filtered out. Thanks to this, we won't have to deal with any error handling due to inaccessible files inside the loop processing the files.

Now that we have an iterator over all the files, we can narrow it down to only the files that we are interested in. In this case, we are only interested in files with the `.ts` or `.tsx` extension:

```rust
static EXTENSIONS_TO_SEARCH: [&str; 2] = ["ts", "tsx"];

for file in walker.filter(|e| e.path().is_file()) {
    if let Some(ext) = file.path().extension() {
        if EXTENSIONS_TO_SEARCH.contains(&ext.to_str().unwrap()) {
            println!("Doing things with {}", file.path().to_str().unwrap());
        }
    }
}
```

## Finding translation keys in code

Now that we have an iterator over all the files that we want to check, we can start looking for translation keys in the code. We do this by reading each file and searching for patterns that signify the use of a translation key. Unfortunately, there are many different ways to use a translation key in our codebase, so we need to look for multiple patterns.

### The TSFile struct

This struct is similar to the `TranslationFile` struct, but instead of representing a translation file, it represents a TypeScript file. It contains the path to the file, and a `File` object that we can use to read the file:

```rust
pub struct TSFile {
    pub file: File,
    pub path: PathBuf,
}
```

Translation keys found in the code are represented by the `KeyUsage` struct:

```rust
pub struct KeyUsage {
    pub key: String,
    pub line: usize,
    pub file_path: PathBuf,
}
```

These fields are used to display information about the key usage to the user. By combining the `line` and `file_path` fields, we can create a link that takes the user directly to the line where the key is used by simply printing `file_path:line` in the terminal. This makes fixing invalid key usages a little bit easier.

### Finding specific usage patterns

The `find_formatted_message_usages()` method searches for translation keys used in the `<FormattedMessage />` component. It looks for patterns beginning with `<FormattedMessage` followed by `id=` to find the keys:

```rust
pub fn find_formatted_message_usages(&mut self) -> Vec<KeyUsage> {
    self.find_usages("<FormattedMessage", "id=")
}
```

Similarly, the `find_format_message_usages()` method is tuned to find keys used with the `formatMessage()` function. It looks for patterns starting with `formatMessage(` followed by `id:`:

```rust
pub fn find_format_message_usages(&mut self) -> Vec<KeyUsage> {
    self.find_usages("formatMessage(", "id:")
}
```

For other non-standard usage patterns found in the codebase, the `find_misc_usages()` method is used. This method checks various identifiers, which might be customized according to your needs. In the future this should be configurable through a config file:

```rust
pub fn find_misc_usages(&mut self) -> Vec<KeyUsage> {
    let identifiers = [
        "translationId:",
        "translationKey:",
        "transId:",
        "pageTitleId=",
        "titleId=",
    ];

    self.find_usages_multiple_tags(identifiers)
}
```

### Extracting the translation keys

The `find_usages()` and `find_usages_multiple_tags()` methods are the core of the key extraction process. They iterate over each line of a file, identifying patterns that signify the use of a translation key and then extracts the key and its usage details (such as the line number and file path).

I apologize in advance for the following method, as it is quite messy and hard to follow. I am not very happy with it, but I haven't been able to come up with a prettier solution yet:

```rust
fn find_usages(&mut self, opening_tag: &str, id_tag: &str) -> Vec<KeyUsage> {
    let mut results = Vec::new();
    let mut found_opening = false;
    let mut found_ternary = false;
    for (line_number, line_result) in BufReader::new(&self.file).lines().enumerate() {
        if let Ok(line) = line_result {
            if line.contains(opening_tag) {
                found_opening = true;
            }

            if found_opening {
                if let Ok((_, key)) = extract_id(&line, id_tag) {
                    results.push(KeyUsage {
                        key,
                        line: line_number + 1,
                        file_path: self.path.to_path_buf(),
                    });
                    found_ternary = false;
                    found_opening = false;
                } else if line.contains('?') {
                    if let Ok((_, key)) = extract_quoted_string(&line) {
                        results.push(KeyUsage {
                            key,
                            line: line_number + 1,
                            file_path: self.path.to_path_buf(),
                        });
                    }
                    found_ternary = true;
                } else if found_ternary && line.contains(':') {
                    if let Ok((_, key)) = extract_quoted_string(&line) {
                        results.push(KeyUsage {
                            key,
                            line: line_number + 1,
                            file_path: self.path.to_path_buf(),
                        });
                    }
                    found_ternary = false;
                    found_opening = false;
                } else if line.contains("/>") {
                    found_ternary = false;
                    found_opening = false;
                }
            }
        }
    }

    self.file.seek(std::io::SeekFrom::Start(0)).unwrap();
    results
}
```

This method is used to find both `<FormattedMessage />` and `formatMessage()` usages. The `opening_tag` parameter is used to identify the start of the usage pattern, and the `id_tag` parameter is used to identify the start of the translation key.

The method iterates over each line of the file, looking for the `opening_tag`. Once it finds it, it starts looking for the `id_tag`. If it finds it, it extracts the key and adds it to the results. If it doesn't find it, it looks for a ternary operator `?` _(which is often used to conditionally render a translation in our codebase)_ and then looks for the `id_tag` again. If it finds it, it extracts the key and adds it to the results.

Keeping track of the state of the method is done with the `found_opening` and `found_ternary` variables. These variables are used to determine if the method is currently looking for an `id_tag` or if it's looking for the second part of a ternary operator. If the method finds a `/>` tag, it resets the state variables, as this means that we failed to find the `id_tag` and are now looking for a new `opening_tag`.

### Key extraction utilities

To facilitate key extraction, I use a couple of utility functions: `extract_id()` and `extract_quoted_string()`. These functions utilize [nom](https://github.com/rust-bakery/nom) to navigate to the desired tags and extract the enclosed keys:

```rust
fn extract_id<'a>(input: &'a str, id_tag: &'a str) -> IResult<&'a str, String> {
    let (input, _) = take_until(id_tag)(input)?;
    let (input, _) = tag(id_tag)(input)?;

    let (input, _) = take_until("\"")(input)?;
    let (input, id) = fenced("\"", "\"")(input)?;

    Ok((input, id.to_string()))
}

fn extract_quoted_string(input: &str) -> IResult<&str, String> {
    let (input, _) = take_until("\"")(input)?;
    let (input, id) = fenced("\"", "\"")(input)?;

    Ok((input, id.to_string()))
}
```

I wanted to try out `nom` for this project, as I've seen really cool examples of it being used to parse complex data structures. However, it might be overkill for this use case, and I'm not sure if it's worth the extra complexity. I also think that there might be some skill issues in play here, as `nom` is not the easiest library to work with and this is my first time using it.

This could probably also have been done with something like [tree-sitter](https://tree-sitter.github.io/tree-sitter/). I've been wanting to try that out as well, but it feels like an even bigger overkill for this use case. If I would expand this project to include an LSP server for instant feedback in the editor, then I would consider using `tree-sitter`.

## Putting it all together

Now that we have all the pieces in place, we can start putting them together. A simplified version of the `main()` function could look something like this:

```rust
static EXTENSIONS_TO_SEARCH: [&str; 2] = ["ts", "tsx"];

fn main() {
    let args = Args::parse();

    let mut en_file = TranslationFile::new(args.en_file).unwrap();
    let mut sv_file = TranslationFile::new(args.sv_file).unwrap();

    en_file.is_compatible_with(&sv_file).unwrap();

    let walker = WalkDir::new(args.root_dir)
        .into_iter()
        .filter_entry(|e| !is_node_modules(e))
        .filter_map(|e| e.ok());

    let mut key_usages = Vec::new();
    for file in walker.filter(|e| e.path().is_file()) {
        if let Some(ext) = file.path().extension() {
            if EXTENSIONS_TO_SEARCH.contains(&ext.to_str().unwrap()) {
                let mut ts_file = TSFile::new(file.path());

                // collect key usages from different methods
                let formatted_message_keys = ts_file.find_formatted_message_usages();
                let format_message_keys = ts_file.find_format_message_usages();
                let misc_usages = ts_file.find_misc_usages();

                // extend the key_usages vector with the findings
                key_usages.extend(format_message_keys);
                key_usages.extend(formatted_message_keys);
                key_usages.extend(misc_usages);
            }
        }
    }

    // check that all usages are valid
    let mut n_invalid_usages = 0;

    let entries = en_translation_file.as_ref().unwrap().entries.clone(); // hehe
    key_usages.iter().for_each(|usage| {
        if !entries.contains_key(usage.key.as_str()) {
            println!(
                "[INVALID] key {} does not exist! {}",
                usage.key,
                usage.file_path.to_str().unwrap()
            );
            n_invalid_usages += 1;
        }
    });

    if n_invalid_usages != 0 {
        println!(
            "{}{}",
            style("ERROR").red().bold(),
            style(format!(": {} invalid key usages!", n_invalid_usages)).bold(),
        );
        std::process::exit(1);
    }
}
```

I have obviously omitted a ton of code here, but you get the idea. In the real version, there are a lot of pretty printing to the terminal _(using the [console](https://crates.io/crates/console) crate)_, finding unused keys, and ignoring certain keys present in a config file _(among other things)_. You can find the full source code for the CLI tool [here](https://github.com/ponbac/ramilang) if you are interested. It's still a work in progress, but it's already usable and has helped us find a lot of issues in our translations.

Hopefully this post has shown you that `Rust` is not that scary, and that not a lot of code is needed to build something quite useful with it _(even for someone like me who has very limited experience with the language)_.

How I turn this `Rust` code into a cross-platform `npm` package and use it in our CI will be covered in the next part of this series. I will probably also write a third part about how I bundled a frontend built with [htmx](https://htmx.org/) for editing translations into the final binary.
