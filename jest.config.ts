import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // singing-score/ and lake-fishing/ are standalone Vite apps tested with their own vitest setup.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/singing-score/', '<rootDir>/lake-fishing/'],
  modulePathIgnorePatterns: ['<rootDir>/singing-score/', '<rootDir>/lake-fishing/'],
}

export default createJestConfig(config)
