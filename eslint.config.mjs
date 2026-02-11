export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.js"
    ]
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        console: "readonly",
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        global: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "eqeqeq": ["error", "always"],
      "no-var": "warn",
      "prefer-const": "warn"
    }
  }
];
