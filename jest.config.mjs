/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "\\.(css|less|scss|sass)$": "<rootDir>/tests/__mocks__/styleMock.js",
  },
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.{ts,tsx}",
    "<rootDir>/tests/integration/**/*.test.{ts,tsx}",
    "<rootDir>/tests/parity/**/*.test.{ts,tsx}",
    "<rootDir>/tests/structure/**/*.test.{ts,tsx}",
  ],
  testPathIgnorePatterns: ["<rootDir>/tests/e2e/", "<rootDir>/node_modules/"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { jsx: "react-jsx", esModuleInterop: true } },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};

export default config;
