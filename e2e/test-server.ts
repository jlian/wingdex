export const testServerPort = Number(process.env.PLAYWRIGHT_PORT || 5100)
export const testBaseURL = `http://localhost:${testServerPort}`
