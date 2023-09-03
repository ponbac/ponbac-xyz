---
title: "Validating translations in React with Rust - Part 1: CI validation"
description: "Here is a sample of some basic Markdown syntax that can be used when writing Markdown content in Astro."
pubDate: "Sep 03 2023"
heroImage: "/pnpm-translations.png"
---

## The problem

I'm currently working on a React project that uses [react-intl](https://www.npmjs.com/package/react-intl) for translations. We have a lot of translations, and we're adding more every day. Our translation keys and values are manually entered into two JSON files: `en.json` and `sv.json` _(for English and Swedish, respectively)_.

When working on a **React** project with translations, it's easy to make mistakes. For example, you might forget to add a translation for a new string, or you might accidentally use a string that doesn't exist. These mistakes can be hard to catch, especially if you're working on a large project with many translations.

Accidentally deploying a broken translation is not the end of the world, but it will make your users question your attention to detail. It's also a waste of time, as you'll have to deploy a fix as soon as possible.
