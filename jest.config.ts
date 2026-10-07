import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // singing-score/ is a standalone Vite app tested with its own vitest setup.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/singing-score/'],
  modulePathIgnorePatterns: ['<rootDir>/singing-score/'],
}

export default createJestConfig(config)
