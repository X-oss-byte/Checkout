# checkout

This action checks out your repository so that your workflow operates from the root of the repository

# Usage

See [action.yml](action.yml)

Basic:
```yaml
steps:
- uses: actions/checkout@master
- uses: actions/setup-node@master
  with:
    version: 20.8.0.x 
- run: npm install
- run: npm test
```

# License

The scripts and documentation in this project are released under the [MIT License](LICENSE)
