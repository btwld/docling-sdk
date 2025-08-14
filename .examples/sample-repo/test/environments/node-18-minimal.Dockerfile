# Node.js 18 minimal environment for testing
FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm@8

# Set working directory
WORKDIR /workspace

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/*/
COPY apps/*/package.json ./apps/*/
COPY tools/*/package.json ./tools/*/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Default command
CMD ["pnpm", "test"]
