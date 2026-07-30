# Pull Request

## What Changed

A clear and concise description of what this PR changes and why.

## Related Issues

- Closes #
- Fixes #

## Commit Type

- [ ] `feat`: A new feature
- [ ] `fix`: A bug fix
- [ ] `docs`: Documentation only changes
- [ ] `style`: Changes that do not affect the meaning of the code
- [ ] `refactor`: A code change that neither fixes a bug nor adds a feature
- [ ] `perf`: A code change that improves performance
- [ ] `test`: Adding missing tests or correcting existing tests
- [ ] `build`: Changes that affect the build system or external dependencies
- [ ] `ci`: Changes to our CI configuration files and scripts
- [ ] `chore`: Other changes that don't modify src or test files
- [ ] `revert`: Reverts a previous commit

## Testing Done

Describe the tests you ran and how to reproduce them.

1. 
2. 
3. 

## Security Review

If this PR touches API endpoints, authentication, database queries, or contract code, check the applicable items from [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md). Paste relevant items below:

```markdown
- [ ] A01-1: Public endpoints correctly excluded from auth
- [ ] A03-1: SQL uses parameterised statements
- [ ] A03-2: User input validated with Zod schema
- [ ] A05-1: CORS scoped to known origins
- [ ] A09-1: API requests logged with request ID
- [ ] Dependency changes reviewed for vulnerabilities
```

## Checklist

- [ ] Code follows the existing style and patterns of the project
- [ ] Tests added or updated to cover the change
- [ ] All tests pass locally (`npm test` / `cargo test`)
- [ ] UI changes include screenshots or a screen recording
- [ ] PR title is descriptive and references the issue number
- [ ] Security checklist items reviewed (if applicable)

## Screenshots (if applicable)

Add screenshots or recordings for visual changes.
