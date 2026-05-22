# App Creation Guidelines

These are instructions every developer must follow when creating, maintaining, and testing our app. Follow them strictly to ensure quality, readability, and maintainability.

## Coder’s Notes
Every file must start with a comment block:
```
//
File: <filename>
Author: Quinn Harvey Pineda
Date: 2026-05-19
Purpose: <purpose>
//
```
Add inline comments for tricky logic.

## Project Structure
All project files should be organized clearly:
- `src/models`: Data models/types.
- `src/controllers`: Business logic (if applicable, or shared logic).
- `src/views`: UI templates or frontend components/pages.
- `src/utils`: Helper functions.
- `src/services`: External APIs or integrations (Firebase, Google APIs).
- `tests`: Unit and integration tests.
- `docs`: Documentation.
- `config`: Configuration files.
- `assets`: Images, fonts, or other media.

## Error Handling
- Handle exceptions, validate inputs, check resources before use.
- Log errors clearly using structured logging (INFO, WARN, ERROR).
- Do not leave unhandled exceptions.

## Best Practices
- Avoid repeating code (DRY principle).
- Keep code readable over clever.
- Remove unused code immediately.
- Peer review all code before merging.
- Check for performance bottlenecks.

## Developer Checklist Before Submitting Code
- [ ] Coder’s notes included
- [ ] Folder structure correct
- [ ] Functions documented
- [ ] Error handling implemented
- [ ] Logging & monitoring implemented
- [ ] Peer-reviewed
