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

## Parsing the 