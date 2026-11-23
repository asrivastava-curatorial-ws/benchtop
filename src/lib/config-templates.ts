/**
 * Templates for the Config Generator: starting files for CI/CD, containers,
 * Kubernetes, monitoring, cloud, web publishing and project tooling, filled in
 * from a few shared fields.  Each produces a complete, working file.
 */
import type { Lang } from '../tools/types';

export type FieldKind = 'text' | 'number' | 'choice' | 'toggle' | 'lines';

export interface Field {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly default: string | number | boolean;
  readonly choices?: readonly (readonly [string, string])[];
  readonly help?: string;
  /** Masked in the form and never saved. */
  readonly secret?: boolean;
}

export type Values = Readonly<Record<string, unknown>>;

export interface ConfigTemplate {
  readonly id: string;
  readonly group: string;
  readonly name: string;
  /** Where the file goes, relative to the project. */
  readonly file: string | ((v: Values) => string);
  readonly lang: Lang;
  readonly about: string;
  readonly fields: readonly string[];
  readonly render: (v: Values) => string;
}

const year = new Date().getFullYear();

export const FIELDS: readonly Field[] = [
  { key: 'name', label: 'Project name', kind: 'text', default: 'museum-guide' },
  { key: 'description', label: 'Description', kind: 'text', default: 'Visitor guide for the science museum' },
  { key: 'version', label: 'Version', kind: 'text', default: '1.0.0' },
  { key: 'author', label: 'Author', kind: 'text', default: 'Your Name' },
  { key: 'email', label: 'Contact email', kind: 'text', default: 'webmaster@example.org' },
  { key: 'url', label: 'Site address', kind: 'text', default: 'https://example.org' },
  { key: 'domain', label: 'Domain', kind: 'text', default: 'example.org' },
  {
    key: 'license',
    label: 'Licence',
    kind: 'choice',
    default: 'MIT',
    choices: [
      ['MIT', 'MIT'],
      ['Apache-2.0', 'Apache 2.0'],
      ['GPL-3.0-or-later', 'GPL 3.0'],
      ['BSD-3-Clause', 'BSD 3-clause'],
    ],
  },
  {
    key: 'node',
    label: 'Node.js version',
    kind: 'choice',
    default: '22',
    choices: [
      ['24', '24'],
      ['22', '22 (LTS)'],
      ['20', '20'],
    ],
  },
  {
    key: 'python',
    label: 'Python version',
    kind: 'choice',
    default: '3.12',
    choices: [
      ['3.13', '3.13'],
      ['3.12', '3.12'],
      ['3.11', '3.11'],
      ['3.10', '3.10'],
    ],
  },
  { key: 'go', label: 'Go version', kind: 'text', default: '1.23' },
  { key: 'port', label: 'Port', kind: 'number', default: 3000 },
  { key: 'command', label: 'Start command', kind: 'text', default: 'node server.js' },
  { key: 'build', label: 'Build command', kind: 'text', default: 'npm run build' },
  { key: 'test', label: 'Test command', kind: 'text', default: 'npm test' },
  { key: 'output', label: 'Build output folder', kind: 'text', default: 'dist' },
  { key: 'branch', label: 'Main branch', kind: 'text', default: 'main' },
  { key: 'image', label: 'Container image', kind: 'text', default: 'ghcr.io/example/museum-guide:1.0.0' },
  { key: 'replicas', label: 'Replicas', kind: 'number', default: 2 },
  { key: 'namespace', label: 'Namespace', kind: 'text', default: 'default' },
  { key: 'cpu', label: 'CPU request', kind: 'text', default: '250m' },
  { key: 'memory', label: 'Memory limit', kind: 'text', default: '256Mi' },
  { key: 'schedule', label: 'Schedule (cron)', kind: 'text', default: '0 2 * * *', help: 'Minute hour day month weekday; 0 2 * * * is 02:00 every day' },
  { key: 'region', label: 'Cloud region', kind: 'text', default: 'ap-south-1' },
  { key: 'bucket', label: 'Bucket name', kind: 'text', default: 'museum-guide-site' },
  { key: 'targets', label: 'Targets (one host:port per line)', kind: 'lines', default: 'localhost:9100\nlocalhost:8080' },
  { key: 'urls', label: 'Page addresses (one per line)', kind: 'lines', default: 'https://example.org/\nhttps://example.org/visit/\nhttps://example.org/galleries/\nhttps://example.org/events/' },
  { key: 'alternates', label: 'Language versions (code and address per line)', kind: 'lines', default: 'en https://example.org/en/\nhi https://example.org/hi/\nkn https://example.org/kn/' },
  { key: 'org', label: 'Organisation', kind: 'text', default: 'Example Science Museum' },
  { key: 'street', label: 'Street address', kind: 'text', default: '5 Kasturba Road' },
  { key: 'city', label: 'City', kind: 'text', default: 'Bengaluru' },
  { key: 'state', label: 'State or region', kind: 'text', default: 'Karnataka' },
  { key: 'postcode', label: 'Postcode', kind: 'text', default: '560001' },
  { key: 'country', label: 'Country code', kind: 'text', default: 'IN' },
  { key: 'phone', label: 'Telephone', kind: 'text', default: '+91 80 0000 0000' },
  { key: 'hours', label: 'Opening hours', kind: 'text', default: 'Mo-Su 09:30-18:00', help: 'Schema.org format: days and times, e.g. Tu-Su 10:00-17:30' },
  { key: 'event', label: 'Event name', kind: 'text', default: 'Science Film Festival' },
  { key: 'start', label: 'Starts', kind: 'text', default: `${year}-12-10T10:00:00+05:30` },
  { key: 'end', label: 'Ends', kind: 'text', default: `${year}-12-14T18:00:00+05:30` },
  {
    key: 'faq',
    label: 'Questions (question | answer per line)',
    kind: 'lines',
    default: 'What are the opening hours? | 9:30 to 18:00, every day except Holi and Diwali.\nIs photography allowed? | Yes, without flash.',
  },
  { key: 'env', label: 'Variables (NAME=value per line)', kind: 'lines', default: 'NODE_ENV=production\nPORT=3000\nDATABASE_URL=postgres://user:password@localhost:5432/app' },
  { key: 'timezone', label: 'Time zone', kind: 'text', default: 'Asia/Kolkata' },
  { key: 'gcpRegion', label: 'Google Cloud region', kind: 'text', default: 'asia-south1' },
  { key: 'storage', label: 'Storage size', kind: 'text', default: '10Gi' },
  { key: 'origins', label: 'Allowed origins (one per line)', kind: 'lines', default: 'https://example.org\nhttps://admin.example.org' },
  {
    key: 'crumbs',
    label: 'Breadcrumbs (name | address per line)',
    kind: 'lines',
    default: 'Home | https://example.org/\nGalleries | https://example.org/galleries/\nSpace gallery | https://example.org/galleries/space/',
  },
  { key: 'headline', label: 'Article headline', kind: 'text', default: 'How the steam engine reached Indian railways' },
  { key: 'published', label: 'Published', kind: 'text', default: `${year}-11-01` },
  { key: 'dbhost', label: 'Database host', kind: 'text', default: 'localhost' },
  { key: 'dbport', label: 'Database port', kind: 'text', default: '', help: 'Leave empty for the usual port' },
  { key: 'dbname', label: 'Database name', kind: 'text', default: 'museum' },
  { key: 'dbuser', label: 'User', kind: 'text', default: 'app' },
  { key: 'dbpassword', label: 'Password', kind: 'text', default: 'change-me', secret: true },
  { key: 'dbssl', label: 'Require TLS', kind: 'toggle', default: false },
  { key: 'typescript', label: 'TypeScript', kind: 'toggle', default: true },
  {
    key: 'framework',
    label: 'Framework',
    kind: 'choice',
    default: 'react',
    choices: [
      ['react', 'React'],
      ['vue', 'Vue'],
      ['preact', 'Preact'],
      ['vanilla', 'None'],
    ],
  },
];

export const FIELD_BY_KEY: ReadonlyMap<string, Field> = new Map(FIELDS.map((f) => [f.key, f]));

const str = (v: Values, key: string): string => {
  const value = v[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const fallback = FIELD_BY_KEY.get(key)?.default;
  return fallback === undefined ? '' : String(fallback);
};
const int = (v: Values, key: string): number => {
  const n = Number(str(v, key));
  return Number.isFinite(n) ? Math.round(n) : Number(FIELD_BY_KEY.get(key)?.default ?? 0);
};
const yes = (v: Values, key: string): boolean => (typeof v[key] === 'boolean' ? (v[key] as boolean) : FIELD_BY_KEY.get(key)?.default === true);
const lines = (v: Values, key: string): string[] =>
  str(v, key)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
/** A safe identifier for names that become labels, resources or packages. */
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = (value: unknown) => JSON.stringify(value, null, 2);
/** Plain YAML when safe; quoted when it would read as a number, boolean or null. */
const yamlString = (text: string) => (/^[\w./:@-]+$/.test(text) && !/^([-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?|true|false|yes|no|on|off|null|~)$/i.test(text) ? text : JSON.stringify(text));
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const groovy = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const unique = <T>(items: T[]) => [...new Set(items)];
/** libpq key=value quoting. */
const libpq = (text: string) => (text === '' || /[\s'\\]/.test(text) ? `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : text);
/** Connection details, raw and URL-encoded, with the usual port when none is given. */
const connection = (v: Values, usualPort: number) => {
  const rawHost = str(v, 'dbhost').trim() || 'localhost';
  const rawUser = str(v, 'dbuser');
  const rawPassword = str(v, 'dbpassword');
  const rawDb = str(v, 'dbname');
  const port = str(v, 'dbport').trim();
  const user = encodeURIComponent(rawUser);
  const password = encodeURIComponent(rawPassword);
  return {
    rawHost,
    rawUser,
    rawPassword,
    rawDb,
    user,
    password,
    auth: `${user}:${password}`,
    host: rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost,
    db: encodeURIComponent(rawDb),
    port: /^\d{1,5}$/.test(port) ? Number(port) : usualPort,
  };
};

export const TEMPLATES: readonly ConfigTemplate[] = [
  /* --------------------------------------------------------------- CI/CD -- */
  {
    id: 'gha-node',
    group: 'CI/CD',
    name: 'GitHub Actions: Node.js build and test',
    file: '.github/workflows/ci.yml',
    lang: 'yaml',
    about: 'Installs dependencies with the npm cache, then builds and tests on every push and pull request.',
    fields: ['node', 'branch', 'build', 'test'],
    render: (v) => `name: CI

on:
  push:
    branches: [${str(v, 'branch')}]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${str(v, 'node')}
          cache: npm
      - run: npm ci
      - run: ${str(v, 'build')}
      - run: ${str(v, 'test')}
`,
  },
  {
    id: 'gha-python',
    group: 'CI/CD',
    name: 'GitHub Actions: Python tests',
    file: '.github/workflows/tests.yml',
    lang: 'yaml',
    about: 'Runs pytest on several Python versions, with pip caching.',
    fields: ['python', 'branch'],
    render: (v) => `name: Tests

on:
  push:
    branches: [${str(v, 'branch')}]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [${unique(['3.10', str(v, 'python')])
          .map((x) => JSON.stringify(x))
          .join(', ')}]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
          cache: pip
      - run: pip install -r requirements.txt pytest
      - run: pytest
`,
  },
  {
    id: 'gha-docker',
    group: 'CI/CD',
    name: 'GitHub Actions: build and push a container image',
    file: '.github/workflows/image.yml',
    lang: 'yaml',
    about: 'Builds the Dockerfile and pushes it to GitHub Container Registry for tags like v1.2.3 and the main branch.',
    fields: ['branch'],
    render: (v) => `name: Container image

on:
  push:
    branches: [${str(v, 'branch')}]
    tags: ["v*"]

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/\${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`,
  },
  {
    id: 'gha-pages',
    group: 'CI/CD',
    name: 'GitHub Actions: deploy a static site to GitHub Pages',
    file: '.github/workflows/pages.yml',
    lang: 'yaml',
    about: 'Builds the site and publishes the output folder with GitHub Pages (Settings, Pages, Source: GitHub Actions).',
    fields: ['node', 'branch', 'build', 'output'],
    render: (v) => `name: Pages

on:
  push:
    branches: [${str(v, 'branch')}]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${str(v, 'node')}
          cache: npm
      - run: npm ci
      - run: ${str(v, 'build')}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${str(v, 'output')}
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`,
  },
  {
    id: 'gitlab-ci',
    group: 'CI/CD',
    name: 'GitLab CI: test, build and deploy',
    file: '.gitlab-ci.yml',
    lang: 'yaml',
    about: 'Three stages with a cached node_modules; deploy runs by hand from the main branch.',
    fields: ['node', 'branch', 'build', 'test', 'output'],
    render: (v) => `image: node:${str(v, 'node')}

stages: [test, build, deploy]

cache:
  key:
    files: [package-lock.json]
  paths: [.npm/]

before_script:
  - npm ci --cache .npm --prefer-offline

test:
  stage: test
  script:
    - ${str(v, 'test')}

build:
  stage: build
  script:
    - ${str(v, 'build')}
  artifacts:
    paths: [${str(v, 'output')}/]

deploy:
  stage: deploy
  script:
    - echo "Deploy ${str(v, 'output')}/ here"
  rules:
    - if: $CI_COMMIT_BRANCH == "${str(v, 'branch')}"
      when: manual
`,
  },
  {
    id: 'dependabot',
    group: 'CI/CD',
    name: 'Dependabot updates',
    file: '.github/dependabot.yml',
    lang: 'yaml',
    about: 'Weekly pull requests for npm packages, GitHub Actions and Docker base images.',
    fields: [],
    render: () => `version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      minor-and-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
`,
  },

  {
    id: 'jenkinsfile',
    group: 'CI/CD',
    name: 'Jenkinsfile (declarative pipeline)',
    file: 'Jenkinsfile',
    lang: 'text',
    about: 'Install, test and build inside a Node.js container, deploy from the main branch, and keep the build output.',
    fields: ['node', 'branch', 'build', 'test', 'output'],
    render: (v) => `pipeline {
  agent {
    docker { image 'node:${str(v, 'node')}-alpine' }
  }
  options {
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }
  stages {
    stage('Install') {
      steps { sh 'npm ci' }
    }
    stage('Test') {
      steps { sh ${groovy(str(v, 'test'))} }
    }
    stage('Build') {
      steps { sh ${groovy(str(v, 'build'))} }
    }
    stage('Deploy') {
      when { branch ${groovy(str(v, 'branch'))} }
      steps { sh ${groovy(`echo Deploy ${str(v, 'output')}/ here`)} }
    }
  }
  post {
    always {
      archiveArtifacts artifacts: ${groovy(`${str(v, 'output')}/**`)}, allowEmptyArchive: true
    }
  }
}
`,
  },
  {
    id: 'circleci',
    group: 'CI/CD',
    name: 'CircleCI configuration',
    file: '.circleci/config.yml',
    lang: 'yaml',
    about: 'Restores the npm cache keyed on package-lock.json, then tests, builds and stores the output.',
    fields: ['node', 'build', 'test', 'output'],
    render: (v) => `version: 2.1

jobs:
  build:
    docker:
      - image: node:${str(v, 'node')}
    steps:
      - checkout
      - restore_cache:
          keys:
            - npm-v1-{{ checksum "package-lock.json" }}
      - run: npm ci
      - save_cache:
          key: npm-v1-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
      - run: ${str(v, 'test')}
      - run: ${str(v, 'build')}
      - store_artifacts:
          path: ${str(v, 'output')}

workflows:
  ci:
    jobs:
      - build
`,
  },
  {
    id: 'azure-pipelines',
    group: 'CI/CD',
    name: 'Azure Pipelines',
    file: 'azure-pipelines.yml',
    lang: 'yaml',
    about: 'Node.js with the npm cache on a Microsoft-hosted Ubuntu agent, publishing the build output as an artifact.',
    fields: ['node', 'branch', 'build', 'test', 'output'],
    render: (v) => `trigger:
  branches:
    include: [${str(v, 'branch')}]

pool:
  vmImage: ubuntu-latest

variables:
  npm_config_cache: $(Pipeline.Workspace)/.npm

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "${str(v, 'node')}.x"
    displayName: Install Node.js
  - task: Cache@2
    inputs:
      key: 'npm | "$(Agent.OS)" | package-lock.json'
      path: $(npm_config_cache)
    displayName: Cache npm
  - script: npm ci
    displayName: Install
  - script: ${str(v, 'test')}
    displayName: Test
  - script: ${str(v, 'build')}
    displayName: Build
  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: ${str(v, 'output')}
      artifact: build
`,
  },
  {
    id: 'bitbucket-pipelines',
    group: 'CI/CD',
    name: 'Bitbucket Pipelines',
    file: 'bitbucket-pipelines.yml',
    lang: 'yaml',
    about: 'Tests and builds every push with the node_modules cache, keeping the build output as an artifact.',
    fields: ['node', 'build', 'test', 'output'],
    render: (v) => `image: node:${str(v, 'node')}

pipelines:
  default:
    - step:
        name: Test and build
        caches:
          - node
        script:
          - npm ci
          - ${str(v, 'test')}
          - ${str(v, 'build')}
        artifacts:
          - ${str(v, 'output')}/**
`,
  },

  /* ---------------------------------------------------------- containers -- */
  {
    id: 'dockerfile-node',
    group: 'Containers',
    name: 'Dockerfile: Node.js app',
    file: 'Dockerfile',
    lang: 'text',
    about: 'Two stages: install and build, then a small runtime image that runs as the unprivileged node user.',
    fields: ['node', 'port', 'build', 'command'],
    render: (v) => `# syntax=docker/dockerfile:1
FROM node:${str(v, 'node')}-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN ${str(v, 'build')} && npm prune --omit=dev

FROM node:${str(v, 'node')}-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE ${int(v, 'port')}
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${int(v, 'port')}/ || exit 1
CMD [${words(str(v, 'command'))
      .map((p) => JSON.stringify(p))
      .join(', ')}]
`,
  },
  {
    id: 'dockerfile-python',
    group: 'Containers',
    name: 'Dockerfile: Python web app',
    file: 'Dockerfile',
    lang: 'text',
    about: 'A slim Python image with dependencies installed first (for layer caching), run by Gunicorn as a non-root user.',
    fields: ['python', 'port'],
    render: (v) => `# syntax=docker/dockerfile:1
FROM python:${str(v, 'python')}-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
RUN useradd --create-home app
USER app
EXPOSE ${int(v, 'port')}
CMD ["gunicorn", "--bind", "0.0.0.0:${int(v, 'port')}", "--workers", "2", "app:app"]
`,
  },
  {
    id: 'dockerfile-go',
    group: 'Containers',
    name: 'Dockerfile: Go service',
    file: 'Dockerfile',
    lang: 'text',
    about: 'Builds a static binary and copies it into a distroless image of a few megabytes.',
    fields: ['go', 'port'],
    render: (v) => `# syntax=docker/dockerfile:1
FROM golang:${str(v, 'go')} AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
EXPOSE ${int(v, 'port')}
ENTRYPOINT ["/app"]
`,
  },
  {
    id: 'dockerfile-static',
    group: 'Containers',
    name: 'Dockerfile: static site with Nginx',
    file: 'Dockerfile',
    lang: 'text',
    about: 'Builds the site with Node.js and serves the output folder from Nginx, with single-page-app fallback.',
    fields: ['node', 'build', 'output'],
    render: (v) => `# syntax=docker/dockerfile:1
FROM node:${str(v, 'node')}-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN ${str(v, 'build')}

FROM nginx:alpine
COPY --from=build /app/${str(v, 'output')} /usr/share/nginx/html
RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  location / { try_files $uri $uri/ /index.html; }\\n}\\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
`,
  },
  {
    id: 'dockerignore',
    group: 'Containers',
    name: '.dockerignore',
    file: '.dockerignore',
    lang: 'text',
    about: 'Keeps dependencies, build output, secrets and version control out of the image context.',
    fields: [],
    render: () => `.git
.github
node_modules
dist
build
coverage
*.log
.env
.env.*
!.env.example
Dockerfile*
docker-compose*.yml
.DS_Store
`,
  },
  {
    id: 'compose-web-db',
    group: 'Containers',
    name: 'Docker Compose: app with PostgreSQL',
    file: 'compose.yaml',
    lang: 'yaml',
    about: 'The app and a PostgreSQL database with a named volume and a health check the app waits for.',
    fields: ['name', 'port', 'image'],
    render: (v) => `services:
  app:
    image: ${str(v, 'image')}
    build: .
    ports:
      - "${int(v, 'port')}:${int(v, 'port')}"
    environment:
      DATABASE_URL: postgres://${slug(str(v, 'name'))}:change-me@db:5432/${slug(str(v, 'name')).replace(/[.-]/g, '_')}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${slug(str(v, 'name'))}
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: ${slug(str(v, 'name')).replace(/[.-]/g, '_')}
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${slug(str(v, 'name'))}"]
      interval: 5s
      retries: 10
    restart: unless-stopped

volumes:
  db-data:
`,
  },

  {
    id: 'compose-monitoring',
    group: 'Containers',
    name: 'Docker Compose: Prometheus, Grafana and node exporter',
    file: 'compose.yaml',
    lang: 'yaml',
    about: 'A monitoring stack for one machine. Put prometheus.yml, alerts.yml and Grafana’s provisioning folder next to it; inside Compose the exporter is node-exporter:9100.',
    fields: [],
    render: () => `services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    volumes:
      - ./provisioning:/etc/grafana/provisioning:ro
      - grafana-data:/var/lib/grafana
    ports:
      - "3001:3000"
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:latest
    pid: host
    command: ["--path.rootfs=/host"]
    volumes:
      - /:/host:ro,rslave
    restart: unless-stopped

volumes:
  prometheus-data:
  grafana-data:
`,
  },

  /* ---------------------------------------------------------- Kubernetes -- */
  {
    id: 'k8s-deployment',
    group: 'Kubernetes',
    name: 'Deployment and Service',
    file: 'deployment.yaml',
    lang: 'yaml',
    about: 'A Deployment with resource limits and probes, and a ClusterIP Service in front of it.',
    fields: ['name', 'namespace', 'image', 'replicas', 'port', 'cpu', 'memory'],
    render: (v) => {
      const n = slug(str(v, 'name'));
      return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${n}
  namespace: ${slug(str(v, 'namespace'))}
  labels:
    app: ${n}
spec:
  replicas: ${int(v, 'replicas')}
  selector:
    matchLabels:
      app: ${n}
  template:
    metadata:
      labels:
        app: ${n}
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: ${n}
          image: ${str(v, 'image')}
          ports:
            - containerPort: ${int(v, 'port')}
          resources:
            requests:
              cpu: ${str(v, 'cpu')}
              memory: ${str(v, 'memory')}
            limits:
              memory: ${str(v, 'memory')}
          readinessProbe:
            httpGet:
              path: /
              port: ${int(v, 'port')}
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: ${int(v, 'port')}
            initialDelaySeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: ${n}
  namespace: ${slug(str(v, 'namespace'))}
spec:
  selector:
    app: ${n}
  ports:
    - port: 80
      targetPort: ${int(v, 'port')}
`;
    },
  },
  {
    id: 'k8s-ingress',
    group: 'Kubernetes',
    name: 'Ingress with TLS',
    file: 'ingress.yaml',
    lang: 'yaml',
    about: 'Routes a domain to the Service, with a certificate from cert-manager (letsencrypt issuer).',
    fields: ['name', 'namespace', 'domain'],
    render: (v) => {
      const n = slug(str(v, 'name'));
      return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${n}
  namespace: ${slug(str(v, 'namespace'))}
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: nginx
  tls:
    - hosts: [${str(v, 'domain')}]
      secretName: ${n}-tls
  rules:
    - host: ${str(v, 'domain')}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${n}
                port:
                  number: 80
`;
    },
  },
  {
    id: 'k8s-configmap',
    group: 'Kubernetes',
    name: 'ConfigMap and Secret from variables',
    file: 'config.yaml',
    lang: 'yaml',
    about: 'Variables whose names contain PASSWORD, SECRET, TOKEN, KEY or a URL with a password go into a Secret; the rest into a ConfigMap.',
    fields: ['name', 'namespace', 'env'],
    render: (v) => {
      const n = slug(str(v, 'name'));
      const pairs = lines(v, 'env').map((l) => {
        const at = l.indexOf('=');
        return at > 0 ? [l.slice(0, at).trim(), l.slice(at + 1).trim()] : [l, ''];
      });
      const secret = (k: string, val: string) => /PASSWORD|SECRET|TOKEN|KEY/i.test(k) || /:\/\/[^/\s:]+:[^@\s]+@/.test(val);
      const plain = pairs.filter(([k, val]) => !secret(k ?? '', val ?? ''));
      const hidden = pairs.filter(([k, val]) => secret(k ?? '', val ?? ''));
      return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${n}-config
  namespace: ${slug(str(v, 'namespace'))}
data:
${plain.map(([k, val]) => `  ${k}: ${JSON.stringify(val)}`).join('\n') || '  {}'}
---
apiVersion: v1
kind: Secret
metadata:
  name: ${n}-secret
  namespace: ${slug(str(v, 'namespace'))}
type: Opaque
stringData:
${hidden.map(([k, val]) => `  ${k}: ${JSON.stringify(val)}`).join('\n') || '  {}'}
`;
    },
  },
  {
    id: 'k8s-cronjob',
    group: 'Kubernetes',
    name: 'CronJob',
    file: 'cronjob.yaml',
    lang: 'yaml',
    about: 'Runs a container on a schedule, never two at once, keeping the last three runs’ history.',
    fields: ['name', 'namespace', 'image', 'schedule', 'timezone', 'command'],
    render: (v) => `apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${slug(str(v, 'name'))}
  namespace: ${slug(str(v, 'namespace'))}
spec:
  schedule: ${JSON.stringify(str(v, 'schedule'))}
  timeZone: ${str(v, 'timezone')}
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: job
              image: ${str(v, 'image')}
              command: [${words(str(v, 'command'))
                .map((p) => JSON.stringify(p))
                .join(', ')}]
`,
  },
  {
    id: 'k8s-hpa',
    group: 'Kubernetes',
    name: 'Horizontal Pod Autoscaler',
    file: 'hpa.yaml',
    lang: 'yaml',
    about: 'Scales the Deployment between its replica count and five times that at 70% average CPU.',
    fields: ['name', 'namespace', 'replicas'],
    render: (v) => `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${slug(str(v, 'name'))}
  namespace: ${slug(str(v, 'namespace'))}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${slug(str(v, 'name'))}
  minReplicas: ${int(v, 'replicas')}
  maxReplicas: ${int(v, 'replicas') * 5}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`,
  },
  {
    id: 'kustomization',
    group: 'Kubernetes',
    name: 'Kustomization',
    file: 'kustomization.yaml',
    lang: 'yaml',
    about: 'Gathers the manifests, sets the namespace and pins the image tag in one place.',
    fields: ['name', 'namespace', 'image'],
    render: (v) => {
      const [repo, tag] = str(v, 'image').split(/:(?=[^/]+$)/);
      return `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${slug(str(v, 'namespace'))}
resources:
  - deployment.yaml
  - ingress.yaml
labels:
  - pairs:
      app.kubernetes.io/name: ${slug(str(v, 'name'))}
images:
  - name: ${repo}
    newTag: ${yamlString(tag ?? 'latest')}
`;
    },
  },
  {
    id: 'helm-chart',
    group: 'Kubernetes',
    name: 'Helm Chart.yaml',
    file: 'Chart.yaml',
    lang: 'yaml',
    about: 'The chart’s name and versions; templates go in templates/ and defaults in values.yaml.',
    fields: ['name', 'description', 'version'],
    render: (v) => `apiVersion: v2
name: ${slug(str(v, 'name'))}
description: ${yamlString(str(v, 'description'))}
type: application
version: 0.1.0
appVersion: ${JSON.stringify(str(v, 'version'))}
`,
  },
  {
    id: 'helm-values',
    group: 'Kubernetes',
    name: 'Helm values.yaml',
    file: 'values.yaml',
    lang: 'yaml',
    about: 'Default values for the chart’s templates: image, replicas, service and resources.',
    fields: ['image', 'replicas', 'port', 'cpu', 'memory'],
    render: (v) => {
      const [repo, tag] = str(v, 'image').split(/:(?=[^/]+$)/);
      return `replicaCount: ${int(v, 'replicas')}
image:
  repository: ${repo}
  tag: ${yamlString(tag ?? 'latest')}
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
  targetPort: ${int(v, 'port')}
resources:
  requests:
    cpu: ${str(v, 'cpu')}
    memory: ${str(v, 'memory')}
  limits:
    memory: ${str(v, 'memory')}
`;
    },
  },

  {
    id: 'k8s-job',
    group: 'Kubernetes',
    name: 'Job (run once)',
    file: 'job.yaml',
    lang: 'yaml',
    about: 'Runs a container to completion, retrying twice, and cleans up an hour after it finishes.',
    fields: ['name', 'namespace', 'image', 'command'],
    render: (v) => `apiVersion: batch/v1
kind: Job
metadata:
  name: ${slug(str(v, 'name'))}-job
  namespace: ${slug(str(v, 'namespace'))}
spec:
  backoffLimit: 2
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: job
          image: ${str(v, 'image')}
          command: [${words(str(v, 'command'))
            .map((p) => JSON.stringify(p))
            .join(', ')}]
`,
  },
  {
    id: 'k8s-pvc',
    group: 'Kubernetes',
    name: 'PersistentVolumeClaim',
    file: 'pvc.yaml',
    lang: 'yaml',
    about: 'Asks the cluster’s default storage class for a disk that one node at a time can write to.',
    fields: ['name', 'namespace', 'storage'],
    render: (v) => `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${slug(str(v, 'name'))}-data
  namespace: ${slug(str(v, 'namespace'))}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: ${str(v, 'storage')}
`,
  },
  {
    id: 'k8s-networkpolicy',
    group: 'Kubernetes',
    name: 'NetworkPolicy',
    file: 'networkpolicy.yaml',
    lang: 'yaml',
    about: 'Blocks all incoming traffic to the namespace’s pods except to the app’s port from pods in the same namespace and the ingress controller.',
    fields: ['name', 'namespace', 'port'],
    render: (v) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: ${slug(str(v, 'namespace'))}
spec:
  podSelector: {}
  policyTypes: [Ingress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-${slug(str(v, 'name'))}
  namespace: ${slug(str(v, 'namespace'))}
spec:
  podSelector:
    matchLabels:
      app: ${slug(str(v, 'name'))}
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: {}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: ${int(v, 'port')}
`,
  },
  {
    id: 'k8s-rbac',
    group: 'Kubernetes',
    name: 'ServiceAccount, Role and RoleBinding',
    file: 'rbac.yaml',
    lang: 'yaml',
    about: 'A service account that may only read pods, services and config maps in its own namespace.',
    fields: ['name', 'namespace'],
    render: (v) => {
      const n = slug(str(v, 'name'));
      const ns = slug(str(v, 'namespace'));
      return `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${n}
  namespace: ${ns}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${n}-reader
  namespace: ${ns}
rules:
  - apiGroups: [""]
    resources: [pods, services, configmaps]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${n}-reader
  namespace: ${ns}
subjects:
  - kind: ServiceAccount
    name: ${n}
    namespace: ${ns}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${n}-reader
`;
    },
  },
  {
    id: 'k8s-pdb',
    group: 'Kubernetes',
    name: 'PodDisruptionBudget',
    file: 'pdb.yaml',
    lang: 'yaml',
    about: 'Keeps at least one pod running while nodes are drained for maintenance.',
    fields: ['name', 'namespace'],
    render: (v) => `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${slug(str(v, 'name'))}
  namespace: ${slug(str(v, 'namespace'))}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: ${slug(str(v, 'name'))}
`,
  },
  {
    id: 'k8s-quota',
    group: 'Kubernetes',
    name: 'ResourceQuota and LimitRange',
    file: 'quota.yaml',
    lang: 'yaml',
    about: 'Caps what the namespace may use in total, and gives containers without requests or limits sensible defaults.',
    fields: ['namespace', 'cpu', 'memory'],
    render: (v) => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: quota
  namespace: ${slug(str(v, 'namespace'))}
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.memory: 16Gi
    pods: "50"
    persistentvolumeclaims: "10"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: defaults
  namespace: ${slug(str(v, 'namespace'))}
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: ${str(v, 'cpu')}
        memory: ${str(v, 'memory')}
      default:
        memory: ${str(v, 'memory')}
`,
  },
  {
    id: 'istio-routing',
    group: 'Kubernetes',
    name: 'Istio Gateway, VirtualService and DestinationRule',
    file: 'istio.yaml',
    lang: 'yaml',
    about: 'Brings the domain in through the Istio ingress gateway with retries and a timeout, and limits connections to the service.',
    fields: ['name', 'namespace', 'domain'],
    render: (v) => {
      const n = slug(str(v, 'name'));
      const ns = slug(str(v, 'namespace'));
      return `apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: ${n}-gateway
  namespace: ${ns}
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: ${n}-tls
      hosts: [${str(v, 'domain')}]
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: ${n}
  namespace: ${ns}
spec:
  hosts: [${str(v, 'domain')}]
  gateways: [${n}-gateway]
  http:
    - route:
        - destination:
            host: ${n}
            port:
              number: 80
      timeout: 10s
      retries:
        attempts: 3
        perTryTimeout: 3s
        retryOn: 5xx,connect-failure,reset
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: ${n}
  namespace: ${ns}
spec:
  host: ${n}
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 100
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 60s
`;
    },
  },

  /* ---------------------------------------------------------- monitoring -- */
  {
    id: 'prometheus',
    group: 'Servers and monitoring',
    name: 'Prometheus scrape configuration',
    file: 'prometheus.yml',
    lang: 'yaml',
    about: 'Scrapes Prometheus itself and the listed targets every 15 seconds, and loads alert rules.',
    fields: ['name', 'targets'],
    render: (v) => `global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - alerts.yml

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: [localhost:9090]
  - job_name: ${slug(str(v, 'name'))}
    static_configs:
      - targets: [${lines(v, 'targets')
        .map((t) => JSON.stringify(t))
        .join(', ')}]
`,
  },
  {
    id: 'prometheus-alerts',
    group: 'Servers and monitoring',
    name: 'Prometheus alert rules',
    file: 'alerts.yml',
    lang: 'yaml',
    about: 'Alerts for a target that stops answering, a disk filling up and sustained high CPU (node exporter metrics).',
    fields: [],
    render: () => `groups:
  - name: basics
    rules:
      - alert: TargetDown
        expr: up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.instance }} is not answering"
      - alert: DiskAlmostFull
        expr: (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes) < 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Less than 10% disk left on {{ $labels.instance }} {{ $labels.mountpoint }}"
      - alert: HighCpu
        expr: 100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 90
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "CPU above 90% on {{ $labels.instance }} for 15 minutes"
`,
  },
  {
    id: 'grafana-datasource',
    group: 'Servers and monitoring',
    name: 'Grafana data source provisioning',
    file: 'provisioning/datasources/prometheus.yaml',
    lang: 'yaml',
    about: 'Adds Prometheus as Grafana’s default data source when Grafana starts.',
    fields: [],
    render: () => `apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      timeInterval: 15s
`,
  },
  {
    id: 'systemd',
    group: 'Servers and monitoring',
    name: 'systemd service',
    file: (v) => `/etc/systemd/system/${slug(str(v, 'name'))}.service`,
    lang: 'text',
    about: 'Runs the app at boot as its own user, restarts it on failure and logs to the journal. Start it with sudo systemctl enable --now and the service name.',
    fields: ['name', 'description', 'command', 'port'],
    render: (v) => `[Unit]
Description=${str(v, 'description')}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${slug(str(v, 'name'))}
WorkingDirectory=/opt/${slug(str(v, 'name'))}
Environment=PORT=${int(v, 'port')}
ExecStart=/usr/bin/env ${str(v, 'command')}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/${slug(str(v, 'name'))}/data

[Install]
WantedBy=multi-user.target
`,
  },

  {
    id: 'grafana-dashboard',
    group: 'Servers and monitoring',
    name: 'Grafana dashboard: machine health',
    file: 'provisioning/dashboards/machine-health.json',
    lang: 'json',
    about: 'Targets up, CPU, memory and free disk from node exporter, using the Prometheus data source above (uid prometheus).',
    fields: ['name'],
    render: (v) => {
      const ds = { type: 'prometheus', uid: 'prometheus' };
      const series = (id: number, title: string, expr: string, x: number, y: number) => ({
        id,
        type: 'timeseries',
        title,
        datasource: ds,
        gridPos: { x, y, w: 12, h: 8 },
        fieldConfig: { defaults: { unit: 'percent', min: 0, max: 100 }, overrides: [] },
        targets: [{ refId: 'A', datasource: ds, expr, legendFormat: '{{instance}}' }],
      });
      return `${json({
        uid: slug(str(v, 'name')).slice(0, 40),
        title: `${str(v, 'name')}: machine health`,
        schemaVersion: 39,
        time: { from: 'now-6h', to: 'now' },
        refresh: '30s',
        panels: [
          {
            id: 1,
            type: 'stat',
            title: 'Targets up',
            datasource: ds,
            gridPos: { x: 0, y: 0, w: 24, h: 4 },
            targets: [{ refId: 'A', datasource: ds, expr: 'sum(up)' }],
          },
          series(2, 'CPU used', '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)', 0, 4),
          series(3, 'Memory used', '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)', 12, 4),
          series(4, 'Disk free', '100 * node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}', 0, 12),
        ],
      })}\n`;
    },
  },
  {
    id: 'grafana-dashboard-provider',
    group: 'Servers and monitoring',
    name: 'Grafana dashboard provisioning',
    file: 'provisioning/dashboards/dashboards.yaml',
    lang: 'yaml',
    about: 'Loads every dashboard JSON file in the folder when Grafana starts.',
    fields: [],
    render: () => `apiVersion: 1
providers:
  - name: files
    type: file
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
`,
  },
  {
    id: 'traefik-static',
    group: 'Servers and monitoring',
    name: 'Traefik static configuration',
    file: 'traefik.yml',
    lang: 'yaml',
    about: 'HTTP to HTTPS redirect, Let’s Encrypt certificates and the dynamic configuration file below.',
    fields: ['email'],
    render: (v) => `entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${str(v, 'email')}
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web

providers:
  file:
    filename: /etc/traefik/dynamic.yml
    watch: true
`,
  },
  {
    id: 'traefik-dynamic',
    group: 'Servers and monitoring',
    name: 'Traefik dynamic configuration (router and service)',
    file: 'dynamic.yml',
    lang: 'yaml',
    about: 'Routes the domain to the app with a certificate and security headers.',
    fields: ['domain', 'port'],
    render: (v) => `http:
  routers:
    app:
      rule: Host(\`${str(v, 'domain')}\`)
      entryPoints: [websecure]
      service: app
      middlewares: [security-headers]
      tls:
        certResolver: letsencrypt
  middlewares:
    security-headers:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        contentTypeNosniff: true
        referrerPolicy: strict-origin-when-cross-origin
  services:
    app:
      loadBalancer:
        servers:
          - url: http://localhost:${int(v, 'port')}
`,
  },
  {
    id: 'ansible-playbook',
    group: 'Servers and monitoring',
    name: 'Ansible playbook: web server',
    file: 'site.yml',
    lang: 'yaml',
    about: 'Installs Nginx, adds a site from a template, opens the firewall and reloads Nginx when something changes. Run with ansible-playbook -i inventory.ini site.yml.',
    fields: ['name', 'port'],
    render: (v) => `- name: Set up the web server
  hosts: web
  become: true
  vars:
    app_name: ${slug(str(v, 'name'))}
    app_port: ${int(v, 'port')}
  tasks:
    - name: Install packages
      ansible.builtin.apt:
        name: [nginx, git]
        state: present
        update_cache: true

    - name: Create the app user
      ansible.builtin.user:
        name: "{{ app_name }}"
        system: true
        create_home: false

    - name: Add the site configuration
      ansible.builtin.template:
        src: templates/site.conf.j2
        dest: "/etc/nginx/sites-available/{{ app_name }}.conf"
        mode: "0644"
      notify: Reload nginx

    - name: Enable the site
      ansible.builtin.file:
        src: "/etc/nginx/sites-available/{{ app_name }}.conf"
        dest: "/etc/nginx/sites-enabled/{{ app_name }}.conf"
        state: link
      notify: Reload nginx

    - name: Allow HTTP and HTTPS
      community.general.ufw:
        rule: allow
        name: Nginx Full

  handlers:
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
`,
  },

  /* --------------------------------------------------------------- cloud -- */
  {
    id: 'terraform-static-site',
    group: 'Cloud',
    name: 'Terraform: S3 bucket for a static site',
    file: 'main.tf',
    lang: 'text',
    about: 'A private S3 bucket with versioning and encryption, ready to put behind CloudFront.',
    fields: ['bucket', 'region'],
    render: (v) => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${str(v, 'region')}"
}

resource "aws_s3_bucket" "site" {
  bucket = "${slug(str(v, 'bucket'))}"
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "bucket" {
  value = aws_s3_bucket.site.bucket
}
`,
  },
  {
    id: 'iam-s3-read',
    group: 'Cloud',
    name: 'AWS IAM policy: read one S3 bucket',
    file: 'policy.json',
    lang: 'json',
    about: 'Least-privilege access to list and read the objects of one bucket.',
    fields: ['bucket'],
    render: (v) =>
      `${json({
        Version: '2012-10-17',
        Statement: [
          { Sid: 'ListBucket', Effect: 'Allow', Action: ['s3:ListBucket'], Resource: [`arn:aws:s3:::${slug(str(v, 'bucket'))}`] },
          { Sid: 'ReadObjects', Effect: 'Allow', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${slug(str(v, 'bucket'))}/*`] },
        ],
      })}\n`,
  },
  {
    id: 's3-public-read',
    group: 'Cloud',
    name: 'S3 bucket policy: public read for a website',
    file: 'bucket-policy.json',
    lang: 'json',
    about: 'Lets anyone read the bucket’s objects (turn off Block Public Access for the bucket first). Prefer CloudFront with origin access control.',
    fields: ['bucket'],
    render: (v) =>
      `${json({ Version: '2012-10-17', Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${slug(str(v, 'bucket'))}/*` }] })}\n`,
  },

  {
    id: 'cloudformation-s3',
    group: 'Cloud',
    name: 'CloudFormation: private S3 bucket',
    file: 'template.yaml',
    lang: 'yaml',
    about: 'An encrypted, versioned bucket with public access blocked. Deploy with aws cloudformation deploy --template-file template.yaml --stack-name and a name.',
    fields: ['bucket'],
    render: (v) => `AWSTemplateFormatVersion: "2010-09-09"
Description: Private bucket for ${slug(str(v, 'bucket'))}

Resources:
  SiteBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: ${slug(str(v, 'bucket'))}
      VersioningConfiguration:
        Status: Enabled
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

Outputs:
  BucketName:
    Value:
      Ref: SiteBucket
`,
  },
  {
    id: 'sam-lambda',
    group: 'Cloud',
    name: 'AWS SAM: Lambda function with an HTTP API',
    file: 'template.yaml',
    lang: 'yaml',
    about: 'A Node.js function on ARM behind an HTTP API. Build and deploy with sam build and sam deploy --guided.',
    fields: ['name', 'node'],
    render: (v) => `AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: ${yamlString(str(v, 'name'))}

Globals:
  Function:
    Runtime: nodejs${str(v, 'node')}.x
    Architectures: [arm64]
    MemorySize: 256
    Timeout: 10

Resources:
  AppFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: index.handler
      Events:
        Api:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY

Outputs:
  ApiUrl:
    Value:
      Fn::Sub: https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/
`,
  },
  {
    id: 'ecs-task',
    group: 'Cloud',
    name: 'AWS ECS task definition (Fargate)',
    file: 'task-definition.json',
    lang: 'json',
    about: 'One container on Fargate with logs in CloudWatch and a health check. Replace the account number in the role.',
    fields: ['name', 'image', 'port', 'region'],
    render: (v) =>
      `${json({
        family: slug(str(v, 'name')),
        networkMode: 'awsvpc',
        requiresCompatibilities: ['FARGATE'],
        cpu: '256',
        memory: '512',
        runtimePlatform: { operatingSystemFamily: 'LINUX', cpuArchitecture: 'X86_64' },
        executionRoleArn: 'arn:aws:iam::123456789012:role/ecsTaskExecutionRole',
        containerDefinitions: [
          {
            name: slug(str(v, 'name')),
            image: str(v, 'image'),
            essential: true,
            portMappings: [{ containerPort: int(v, 'port'), protocol: 'tcp' }],
            logConfiguration: {
              logDriver: 'awslogs',
              options: { 'awslogs-group': `/ecs/${slug(str(v, 'name'))}`, 'awslogs-region': str(v, 'region'), 'awslogs-stream-prefix': 'app', 'awslogs-create-group': 'true' },
            },
            healthCheck: { command: ['CMD-SHELL', `wget -qO- http://localhost:${int(v, 'port')}/ || exit 1`], interval: 30, timeout: 5, retries: 3 },
          },
        ],
      })}\n`,
  },
  {
    id: 'cloud-run',
    group: 'Cloud',
    name: 'Google Cloud Run service',
    file: 'service.yaml',
    lang: 'yaml',
    about: 'Deploy or update with gcloud run services replace service.yaml --region and your region.',
    fields: ['name', 'image', 'port', 'memory'],
    render: (v) => `apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${slug(str(v, 'name'))}
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: "5"
    spec:
      containerConcurrency: 80
      containers:
        - image: ${str(v, 'image')}
          ports:
            - containerPort: ${int(v, 'port')}
          resources:
            limits:
              cpu: "1"
              memory: ${str(v, 'memory')}
`,
  },
  {
    id: 'cloudbuild',
    group: 'Cloud',
    name: 'Google Cloud Build: build and deploy to Cloud Run',
    file: 'cloudbuild.yaml',
    lang: 'yaml',
    about: 'Builds the image, pushes it to Artifact Registry (a repository named apps) and deploys it to Cloud Run.',
    fields: ['name', 'gcpRegion'],
    render: (v) => `steps:
  - name: gcr.io/cloud-builders/docker
    args: [build, -t, "$_IMAGE", .]
  - name: gcr.io/cloud-builders/docker
    args: [push, "$_IMAGE"]
  - name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: gcloud
    args: [run, deploy, ${slug(str(v, 'name'))}, --image, "$_IMAGE", --region, ${str(v, 'gcpRegion')}, --allow-unauthenticated]

substitutions:
  _IMAGE: ${str(v, 'gcpRegion')}-docker.pkg.dev/$PROJECT_ID/apps/${slug(str(v, 'name'))}:$SHORT_SHA

images: ["$_IMAGE"]
`,
  },
  {
    id: 'bicep-storage',
    group: 'Cloud',
    name: 'Azure Bicep: storage account',
    file: 'main.bicep',
    lang: 'text',
    about: 'A StorageV2 account with HTTPS only, TLS 1.2 and no public blob access. Deploy with az deployment group create --template-file main.bicep.',
    fields: ['bucket'],
    render: (v) => `param location string = resourceGroup().location
param name string = '${(
      str(v, 'bucket')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'storage'
    )
      .slice(0, 24)
      .padEnd(3, '0')}'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

output blobEndpoint string = storage.properties.primaryEndpoints.blob
`,
  },

  /* ----------------------------------------------------------------- web -- */
  {
    id: 'sitemap',
    group: 'Web publishing',
    name: 'sitemap.xml',
    file: 'sitemap.xml',
    lang: 'xml',
    about: 'Lists your pages for search engines; mention it in robots.txt with Sitemap: and the address.',
    fields: ['urls'],
    render: (v) => {
      const today = new Date().toISOString().slice(0, 10);
      return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines(v, 'urls')
  .map((u) => `  <url>\n    <loc>${xml(u)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`)
  .join('\n')}
</urlset>
`;
    },
  },
  {
    id: 'hreflang',
    group: 'Web publishing',
    name: 'hreflang tags for language versions',
    file: 'head.html',
    lang: 'html',
    about: 'Tells search engines which page is which language; put the same tags in the head of every version.',
    fields: ['alternates'],
    render: (v) => {
      const rows = lines(v, 'alternates').map((l) => l.split(/\s+/, 2) as [string, string]);
      const first = rows[0]?.[1] ?? '/';
      return `${rows.map(([code, href]) => `<link rel="alternate" hreflang="${xml(code)}" href="${xml(href ?? '')}">`).join('\n')}\n<link rel="alternate" hreflang="x-default" href="${xml(first)}">\n`;
    },
  },
  {
    id: 'schema-museum',
    group: 'Web publishing',
    name: 'Schema.org: museum or organisation',
    file: 'museum.jsonld',
    lang: 'json',
    about: 'Structured data for search results: address, hours and contact. Put it in a <script type="application/ld+json"> tag.',
    fields: ['org', 'url', 'street', 'city', 'state', 'postcode', 'country', 'phone', 'hours', 'email'],
    render: (v) =>
      `${json({
        '@context': 'https://schema.org',
        '@type': 'Museum',
        name: str(v, 'org'),
        url: str(v, 'url'),
        email: str(v, 'email'),
        telephone: str(v, 'phone'),
        address: {
          '@type': 'PostalAddress',
          streetAddress: str(v, 'street'),
          addressLocality: str(v, 'city'),
          addressRegion: str(v, 'state'),
          postalCode: str(v, 'postcode'),
          addressCountry: str(v, 'country'),
        },
        openingHours: str(v, 'hours'),
      })}\n`,
  },
  {
    id: 'schema-event',
    group: 'Web publishing',
    name: 'Schema.org: event',
    file: 'event.jsonld',
    lang: 'json',
    about: 'An event with dates and place, for event listings in search results.',
    fields: ['event', 'start', 'end', 'org', 'street', 'city', 'country', 'url'],
    render: (v) =>
      `${json({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: str(v, 'event'),
        startDate: str(v, 'start'),
        endDate: str(v, 'end'),
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        location: { '@type': 'Place', name: str(v, 'org'), address: { '@type': 'PostalAddress', streetAddress: str(v, 'street'), addressLocality: str(v, 'city'), addressCountry: str(v, 'country') } },
        organizer: { '@type': 'Organization', name: str(v, 'org'), url: str(v, 'url') },
      })}\n`,
  },
  {
    id: 'schema-faq',
    group: 'Web publishing',
    name: 'Schema.org: frequently asked questions',
    file: 'faq.jsonld',
    lang: 'json',
    about: 'Questions and answers as a FAQPage.',
    fields: ['faq'],
    render: (v) =>
      `${json({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: lines(v, 'faq').map((l) => {
          const [q, ...a] = l.split('|');
          return { '@type': 'Question', name: (q ?? '').trim(), acceptedAnswer: { '@type': 'Answer', text: a.join('|').trim() } };
        }),
      })}\n`,
  },
  {
    id: 'web-manifest',
    group: 'Web publishing',
    name: 'Web app manifest',
    file: 'manifest.webmanifest',
    lang: 'json',
    about: 'Makes the site installable as an app; link it with <link rel="manifest" href="/manifest.webmanifest">.',
    fields: ['name', 'description'],
    render: (v) =>
      `${json({
        name: str(v, 'name'),
        short_name: str(v, 'name').slice(0, 12),
        description: str(v, 'description'),
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#17694e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      })}\n`,
  },
  {
    id: 'service-worker',
    group: 'Web publishing',
    name: 'Service worker for offline use',
    file: 'sw.js',
    lang: 'javascript',
    about: 'Caches the listed pages on install and serves from the cache when offline (useful for kiosks). Register it with navigator.serviceWorker.register("/sw.js").',
    fields: ['name', 'version', 'urls'],
    render: (v) => {
      const paths = lines(v, 'urls').map((u) => {
        try {
          return new URL(u).pathname;
        } catch {
          return u;
        }
      });
      return `const CACHE = ${JSON.stringify(`${slug(str(v, 'name'))}-${str(v, 'version')}`)};
const PAGES = ${JSON.stringify(paths)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PAGES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

// Network first for pages (fresh when online), cache first for everything else.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        }),
    ),
  );
});
`;
    },
  },
  {
    id: 'security-txt',
    group: 'Web publishing',
    name: 'security.txt',
    file: '.well-known/security.txt',
    lang: 'text',
    about: 'How security researchers can report problems (RFC 9116). Renew the Expires date every year.',
    fields: ['email', 'url'],
    render: (v) => {
      const expires = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
      return `Contact: mailto:${str(v, 'email')}\nExpires: ${expires}\nPreferred-Languages: en, hi\nCanonical: ${str(v, 'url').replace(/\/$/, '')}/.well-known/security.txt\n`;
    },
  },
  {
    id: 'htaccess',
    group: 'Web publishing',
    name: 'Apache .htaccess',
    file: '.htaccess',
    lang: 'text',
    about: 'HTTPS redirect, single-page-app fallback, compression and long caching for static assets.',
    fields: [],
    render: () => `RewriteEngine On

# Always HTTPS
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Single-page app: unknown paths go to index.html
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_headers.c>
  <FilesMatch "\\.(css|js|woff2|png|jpg|jpeg|webp|avif|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
`,
  },
  {
    id: 'caddyfile',
    group: 'Web publishing',
    name: 'Caddyfile: HTTPS reverse proxy',
    file: 'Caddyfile',
    lang: 'text',
    about: 'Caddy gets and renews the certificate itself and forwards requests to the app.',
    fields: ['domain', 'port'],
    render: (v) => `${str(v, 'domain')} {
\tencode zstd gzip
\treverse_proxy localhost:${int(v, 'port')}
\theader {
\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains"
\t\tX-Content-Type-Options nosniff
\t\tReferrer-Policy strict-origin-when-cross-origin
\t}
}
`,
  },

  {
    id: 'schema-breadcrumb',
    group: 'Web publishing',
    name: 'Schema.org: breadcrumbs',
    file: 'breadcrumbs.jsonld',
    lang: 'json',
    about: 'The page’s place in the site, shown as a path in search results.',
    fields: ['crumbs'],
    render: (v) =>
      `${json({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: lines(v, 'crumbs').map((l, i) => {
          const [name, ...rest] = l.split('|');
          return { '@type': 'ListItem', position: i + 1, name: (name ?? '').trim(), item: rest.join('|').trim() };
        }),
      })}\n`,
  },
  {
    id: 'schema-article',
    group: 'Web publishing',
    name: 'Schema.org: article',
    file: 'article.jsonld',
    lang: 'json',
    about: 'A blog post or news article with author, publisher and date.',
    fields: ['headline', 'author', 'published', 'org', 'url'],
    render: (v) =>
      `${json({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: str(v, 'headline'),
        author: { '@type': 'Person', name: str(v, 'author') },
        publisher: { '@type': 'Organization', name: str(v, 'org'), url: str(v, 'url') },
        datePublished: str(v, 'published'),
        image: [`${str(v, 'url').replace(/\/$/, '')}/images/article.jpg`],
      })}\n`,
  },
  {
    id: 'cors-nginx',
    group: 'Web publishing',
    name: 'CORS for Nginx',
    file: 'cors.conf',
    lang: 'text',
    about: 'Answers browser preflight requests and allows only the listed origins to call the API.',
    fields: ['origins', 'port'],
    render: (v) => `# In the http block
map $http_origin $cors_origin {
    default "";
${lines(v, 'origins')
  .map((o) => `    ${JSON.stringify(o)} $http_origin;`)
  .join('\n')}
}

# In the server block
location /api/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin $cors_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
        add_header Access-Control-Max-Age 86400 always;
        add_header Vary Origin always;
        return 204;
    }
    add_header Access-Control-Allow-Origin $cors_origin always;
    add_header Vary Origin always;
    proxy_pass http://localhost:${int(v, 'port')};
}
`,
  },
  {
    id: 'cors-express',
    group: 'Web publishing',
    name: 'CORS for Express',
    file: 'cors.js',
    lang: 'javascript',
    about: 'The cors middleware (npm install cors) allowing only the listed origins, with cookies.',
    fields: ['origins'],
    render: (v) => `import cors from 'cors';

const allowed = ${JSON.stringify(lines(v, 'origins'))};

export const corsMiddleware = cors({
  // Requests without an Origin header (curl, server to server) are allowed.
  origin: (origin, callback) => callback(null, !origin || allowed.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
  maxAge: 86400,
});

// app.use(corsMiddleware);
`,
  },

  /* ------------------------------------------------------- project tools -- */
  {
    id: 'package-json',
    group: 'Project tooling',
    name: 'package.json',
    file: 'package.json',
    lang: 'json',
    about: 'An ES module package with the usual scripts.',
    fields: ['name', 'description', 'version', 'author', 'license', 'node', 'typescript'],
    render: (v) =>
      `${json({
        name: slug(str(v, 'name')),
        version: str(v, 'version'),
        description: str(v, 'description'),
        type: 'module',
        license: str(v, 'license'),
        author: str(v, 'author'),
        engines: { node: `>=${str(v, 'node')}` },
        scripts: yes(v, 'typescript')
          ? { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview', test: 'vitest run', lint: 'eslint .' }
          : { dev: 'vite', build: 'vite build', preview: 'vite preview', test: 'vitest run', lint: 'eslint .' },
        devDependencies: yes(v, 'typescript') ? { typescript: '^5.7.0', vite: '^6.0.0', vitest: '^3.0.0', eslint: '^9.0.0' } : { vite: '^6.0.0', vitest: '^3.0.0', eslint: '^9.0.0' },
      })}\n`,
  },
  {
    id: 'tsconfig',
    group: 'Project tooling',
    name: 'tsconfig.json',
    file: 'tsconfig.json',
    lang: 'json',
    about: 'Strict TypeScript for a bundled browser app (Vite or similar).',
    fields: ['framework'],
    render: (v) => {
      const f = str(v, 'framework');
      const jsx = f === 'react' ? { jsx: 'react-jsx' } : f === 'preact' ? { jsx: 'react-jsx', jsxImportSource: 'preact' } : {};
      return `${json({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noUncheckedIndexedAccess: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          isolatedModules: true,
          skipLibCheck: true,
          noEmit: true,
          ...jsx,
        },
        include: ['src'],
      })}\n`;
    },
  },
  {
    id: 'eslint',
    group: 'Project tooling',
    name: 'ESLint (flat config)',
    file: 'eslint.config.js',
    lang: 'javascript',
    about: 'ESLint 9’s flat configuration with the recommended rules, and typescript-eslint when TypeScript is on.',
    fields: ['typescript'],
    render: (v) =>
      yes(v, 'typescript')
        ? `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
`
        : `import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
`,
  },
  {
    id: 'prettier',
    group: 'Project tooling',
    name: 'Prettier',
    file: '.prettierrc.json',
    lang: 'json',
    about: 'Single quotes, trailing commas and a 100-column line.',
    fields: [],
    render: () => `${json({ singleQuote: true, trailingComma: 'all', printWidth: 100, semi: true })}\n`,
  },
  {
    id: 'editorconfig',
    group: 'Project tooling',
    name: '.editorconfig',
    file: '.editorconfig',
    lang: 'text',
    about: 'Shared indentation and line endings for every editor.',
    fields: [],
    render: () => `root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.{py,rs,go}]
indent_size = 4

[Makefile]
indent_style = tab

[*.md]
trim_trailing_whitespace = false
`,
  },
  {
    id: 'vite',
    group: 'Project tooling',
    name: 'Vite configuration',
    file: 'vite.config.ts',
    lang: 'typescript',
    about: 'Vite with the framework plugin, a dev server port and the build folder.',
    fields: ['framework', 'port', 'output'],
    render: (v) => {
      const f = str(v, 'framework');
      const plugin =
        f === 'react'
          ? ["import react from '@vitejs/plugin-react';", 'react()']
          : f === 'vue'
            ? ["import vue from '@vitejs/plugin-vue';", 'vue()']
            : f === 'preact'
              ? ["import preact from '@preact/preset-vite';", 'preact()']
              : ['', ''];
      return `import { defineConfig } from 'vite';
${plugin[0] ? `${plugin[0]}\n` : ''}
export default defineConfig({
  plugins: [${plugin[1]}],
  server: { port: ${int(v, 'port')} },
  build: { outDir: '${str(v, 'output')}', sourcemap: true },
});
`;
    },
  },
  {
    id: 'vitest',
    group: 'Project tooling',
    name: 'Vitest configuration',
    file: 'vitest.config.ts',
    lang: 'typescript',
    about: 'Tests in a browser-like environment with coverage.',
    fields: [],
    render: () => `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
});
`,
  },
  {
    id: 'jest',
    group: 'Project tooling',
    name: 'Jest configuration',
    file: 'jest.config.js',
    lang: 'javascript',
    about: 'Jest with ts-jest for TypeScript and a jsdom environment.',
    fields: ['typescript'],
    render: (v) => `/** @type {import('jest').Config} */
export default {
${yes(v, 'typescript') ? "  preset: 'ts-jest',\n" : ''}  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!src/**/*.d.ts'],
  moduleNameMapper: { '\\\\.(css|less|scss)$': 'identity-obj-proxy' },
};
`,
  },
  {
    id: 'babel',
    group: 'Project tooling',
    name: 'Babel configuration',
    file: 'babel.config.json',
    lang: 'json',
    about: 'Modern JavaScript for the browsers in your browserslist, with React and TypeScript presets as needed.',
    fields: ['framework', 'typescript'],
    render: (v) => {
      const presets: unknown[] = [['@babel/preset-env', { targets: 'defaults', bugfixes: true }]];
      if (str(v, 'framework') === 'react') presets.push(['@babel/preset-react', { runtime: 'automatic' }]);
      if (yes(v, 'typescript')) presets.push('@babel/preset-typescript');
      return `${json({ presets })}\n`;
    },
  },
  {
    id: 'rollup',
    group: 'Project tooling',
    name: 'Rollup configuration (library)',
    file: 'rollup.config.mjs',
    lang: 'javascript',
    about: 'Builds a library as ES module and CommonJS bundles with source maps.',
    fields: ['name', 'typescript'],
    render: (v) => `import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
${yes(v, 'typescript') ? "import typescript from '@rollup/plugin-typescript';\n" : ''}
export default {
  input: 'src/index.${yes(v, 'typescript') ? 'ts' : 'js'}',
  output: [
    { file: 'dist/${slug(str(v, 'name'))}.mjs', format: 'es', sourcemap: true },
    { file: 'dist/${slug(str(v, 'name'))}.cjs', format: 'cjs', sourcemap: true },
  ],
  plugins: [resolve(), commonjs()${yes(v, 'typescript') ? ', typescript()' : ''}],
};
`,
  },
  {
    id: 'webpack',
    group: 'Project tooling',
    name: 'webpack configuration',
    file: 'webpack.config.js',
    lang: 'javascript',
    about: 'webpack 5 with Babel, CSS, content-hashed output and a dev server.',
    fields: ['port', 'output'],
    render: (v) => `import path from 'node:path';
import HtmlWebpackPlugin from 'html-webpack-plugin';

export default (_env, argv) => ({
  entry: './src/index.js',
  output: {
    path: path.resolve(import.meta.dirname, '${str(v, 'output')}'),
    filename: argv.mode === 'production' ? '[name].[contenthash].js' : '[name].js',
    clean: true,
  },
  module: {
    rules: [
      { test: /\\.[jt]sx?$/, exclude: /node_modules/, use: 'babel-loader' },
      { test: /\\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\\.(png|jpe?g|gif|svg|webp|woff2?)$/, type: 'asset' },
    ],
  },
  resolve: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
  plugins: [new HtmlWebpackPlugin({ template: './public/index.html' })],
  devServer: { port: ${int(v, 'port')}, historyApiFallback: true },
  devtool: argv.mode === 'production' ? 'source-map' : 'eval-cheap-module-source-map',
});
`,
  },
  {
    id: 'pre-commit',
    group: 'Project tooling',
    name: 'pre-commit hooks',
    file: '.pre-commit-config.yaml',
    lang: 'yaml',
    about: 'Checks for trailing spaces, large files, merge conflicts and leaked secrets before every commit (pip install pre-commit; pre-commit install).',
    fields: [],
    render: () => `repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-merge-conflict
      - id: check-added-large-files
        args: [--maxkb=1024]
      - id: detect-private-key
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2
    hooks:
      - id: gitleaks
`,
  },
  {
    id: 'env-example',
    group: 'Project tooling',
    name: '.env.example',
    file: '.env.example',
    lang: 'text',
    about: 'The variables the app needs, with secrets blanked out, to commit in place of the real .env.',
    fields: ['env'],
    render: (v) =>
      `${lines(v, 'env')
        .map((l) => {
          const at = l.indexOf('=');
          if (at < 0) return l;
          const key = l.slice(0, at).trim();
          const value = l.slice(at + 1).trim();
          const hide = /PASSWORD|SECRET|TOKEN|KEY/i.test(key) || /:\/\/[^/\s:]+:[^@\s]+@/.test(value);
          return `${key}=${hide ? '' : value}`;
        })
        .join('\n')}\n`,
  },

  {
    id: 'postcss',
    group: 'Project tooling',
    name: 'PostCSS configuration',
    file: 'postcss.config.js',
    lang: 'javascript',
    about: 'Autoprefixer always, and cssnano to shrink the CSS in production builds.',
    fields: [],
    render: () => `export default {
  plugins: {
    autoprefixer: {},
    ...(process.env.NODE_ENV === 'production' ? { cssnano: { preset: 'default' } } : {}),
  },
};
`,
  },
  {
    id: 'browserslist',
    group: 'Project tooling',
    name: '.browserslistrc',
    file: '.browserslistrc',
    lang: 'text',
    about: 'The browsers Autoprefixer, Babel and bundlers build for.',
    fields: [],
    render: () => `defaults and fully supports es6-module
not dead
`,
  },
  {
    id: 'renovate',
    group: 'Project tooling',
    name: 'Renovate configuration',
    file: 'renovate.json',
    lang: 'json',
    about: 'Dependency update pull requests once a week, with minor and patch updates grouped.',
    fields: ['timezone'],
    render: (v) =>
      `${json({
        $schema: 'https://docs.renovatebot.com/renovate-schema.json',
        extends: ['config:recommended'],
        timezone: str(v, 'timezone'),
        schedule: ['before 6am on monday'],
        packageRules: [{ matchUpdateTypes: ['minor', 'patch'], groupName: 'minor and patch updates' }],
      })}\n`,
  },
  {
    id: 'makefile',
    group: 'Project tooling',
    name: 'Makefile',
    file: 'Makefile',
    lang: 'text',
    about: 'Short names for the usual commands: make install, make build, make test.',
    fields: ['build', 'test', 'command', 'output'],
    render: (v) => `.PHONY: install build test run clean

install:
\tnpm ci

build:
\t${str(v, 'build')}

test:
\t${str(v, 'test')}

run: build
\t${str(v, 'command')}

clean:
\trm -rf ${str(v, 'output')} node_modules
`,
  },
  {
    id: 'gitattributes',
    group: 'Project tooling',
    name: '.gitattributes',
    file: '.gitattributes',
    lang: 'text',
    about: 'Normalises line endings and stores large media in Git LFS (git lfs install first).',
    fields: [],
    render: () => `* text=auto eol=lf

*.bat text eol=crlf
*.ps1 text eol=crlf

# Large media in Git LFS
*.psd filter=lfs diff=lfs merge=lfs -text
*.mp4 filter=lfs diff=lfs merge=lfs -text
*.mov filter=lfs diff=lfs merge=lfs -text
*.wav filter=lfs diff=lfs merge=lfs -text
*.glb filter=lfs diff=lfs merge=lfs -text
*.blend filter=lfs diff=lfs merge=lfs -text
*.tif filter=lfs diff=lfs merge=lfs -text
`,
  },
  {
    id: 'pyproject',
    group: 'Project tooling',
    name: 'pyproject.toml',
    file: 'pyproject.toml',
    lang: 'text',
    about: 'A Python package built with Hatchling, with Ruff and pytest settings.',
    fields: ['name', 'description', 'version', 'author', 'email', 'license', 'python'],
    render: (v) => `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = ${JSON.stringify(slug(str(v, 'name')))}
version = ${JSON.stringify(str(v, 'version'))}
description = ${JSON.stringify(str(v, 'description'))}
readme = "README.md"
requires-python = ">=${str(v, 'python')}"
license = ${JSON.stringify(str(v, 'license'))}
authors = [{ name = ${JSON.stringify(str(v, 'author'))}, email = ${JSON.stringify(str(v, 'email'))} }]
dependencies = []

[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.6"]

[tool.ruff]
line-length = 100
target-version = "py${str(v, 'python').replace('.', '')}"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
  },

  /* ------------------------------------------------------------------ docs -- */
  {
    id: 'readme',
    group: 'Documentation',
    name: 'README.md',
    file: 'README.md',
    lang: 'markdown',
    about: 'What it is, how to install and run it, and its licence.',
    fields: ['name', 'description', 'license', 'build', 'test', 'command'],
    render: (v) => `# ${str(v, 'name')}

${str(v, 'description')}.

## Install

\`\`\`sh
git clone https://github.com/you/${slug(str(v, 'name'))}.git
cd ${slug(str(v, 'name'))}
npm install
\`\`\`

## Run

\`\`\`sh
${str(v, 'build')}
${str(v, 'command')}
\`\`\`

## Test

\`\`\`sh
${str(v, 'test')}
\`\`\`

## Licence

${str(v, 'license')}. See [LICENSE](LICENSE).
`,
  },
  {
    id: 'changelog',
    group: 'Documentation',
    name: 'CHANGELOG.md (Keep a Changelog)',
    file: 'CHANGELOG.md',
    lang: 'markdown',
    about: 'A changelog in the Keep a Changelog format, with an Unreleased section and the first version.',
    fields: ['version'],
    render: (v) => `# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

## [${str(v, 'version')}] - ${new Date().toISOString().slice(0, 10)}

### Added

- First release.
`,
  },
  {
    id: 'license-mit',
    group: 'Documentation',
    name: 'LICENSE (MIT)',
    file: 'LICENSE',
    lang: 'text',
    about: 'The MIT licence with your name and the year.',
    fields: ['author'],
    render: (v) => `MIT License

Copyright (c) ${year} ${str(v, 'author')}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
  {
    id: 'contributing',
    group: 'Documentation',
    name: 'CONTRIBUTING.md',
    file: 'CONTRIBUTING.md',
    lang: 'markdown',
    about: 'How to set up, test and propose changes.',
    fields: ['name', 'test', 'branch'],
    render: (v) => `# Contributing to ${str(v, 'name')}

Thank you for helping.

1. Fork the repository and create a branch from \`${str(v, 'branch')}\`.
2. Install the dependencies with \`npm install\`.
3. Make your change, with tests where they make sense.
4. Run \`${str(v, 'test')}\` and make sure everything passes.
5. Open a pull request describing what changed and why.

Please report bugs with the steps to reproduce them, what you expected and what happened.
`,
  },
  /* ------------------------------------------------------------ databases -- */
  {
    id: 'conn-postgres',
    group: 'Database connections',
    name: 'PostgreSQL connection strings',
    file: 'postgres.txt',
    lang: 'text',
    about: 'The same connection written for psql and Node.js, JDBC, .NET, Python and an environment variable.',
    fields: ['dbhost', 'dbport', 'dbname', 'dbuser', 'dbpassword', 'dbssl'],
    render: (v) => {
      const c = connection(v, 5432);
      const ssl = yes(v, 'dbssl') ? 'require' : 'prefer';
      return `# URL: psql, Node.js pg, Prisma, Rails, dj-database-url
postgresql://${c.auth}@${c.host}:${c.port}/${c.db}?sslmode=${ssl}

# Key and value (libpq)
host=${libpq(c.rawHost)} port=${c.port} dbname=${libpq(c.rawDb)} user=${libpq(c.rawUser)} password=${libpq(c.rawPassword)} sslmode=${ssl}

# JDBC
jdbc:postgresql://${c.host}:${c.port}/${c.db}?user=${c.user}&password=${c.password}&sslmode=${ssl}

# .NET (Npgsql)
Host=${c.rawHost};Port=${c.port};Database=${c.rawDb};Username=${c.rawUser};Password=${c.rawPassword};SSL Mode=${yes(v, 'dbssl') ? 'Require' : 'Prefer'}

# Python (SQLAlchemy with psycopg 3)
postgresql+psycopg://${c.auth}@${c.host}:${c.port}/${c.db}?sslmode=${ssl}

# Environment variable
DATABASE_URL=postgresql://${c.auth}@${c.host}:${c.port}/${c.db}?sslmode=${ssl}
`;
    },
  },
  {
    id: 'conn-mysql',
    group: 'Database connections',
    name: 'MySQL and MariaDB connection strings',
    file: 'mysql.txt',
    lang: 'text',
    about: 'The same connection for the mysql client, Node.js, JDBC, .NET, PHP and Python.',
    fields: ['dbhost', 'dbport', 'dbname', 'dbuser', 'dbpassword', 'dbssl'],
    render: (v) => {
      const c = connection(v, 3306);
      const tls = yes(v, 'dbssl');
      return `# Command line
mysql --host=${c.rawHost} --port=${c.port} --user=${c.rawUser} --password ${c.rawDb}${tls ? ' --ssl-mode=REQUIRED' : ''}

# URL: Node.js mysql2, Prisma, Rails
mysql://${c.auth}@${c.host}:${c.port}/${c.db}${tls ? '\n# For TLS, Prisma adds ?sslaccept=strict and mysql2 takes an ssl option' : ''}

# JDBC
jdbc:mysql://${c.host}:${c.port}/${c.db}?user=${c.user}&password=${c.password}&sslMode=${tls ? 'REQUIRED' : 'PREFERRED'}

# .NET (MySqlConnector)
Server=${c.rawHost};Port=${c.port};Database=${c.rawDb};User ID=${c.rawUser};Password=${c.rawPassword};SslMode=${tls ? 'Required' : 'Preferred'}

# PHP (PDO)
mysql:host=${c.rawHost};port=${c.port};dbname=${c.rawDb};charset=utf8mb4

# Python (SQLAlchemy with PyMySQL)
mysql+pymysql://${c.auth}@${c.host}:${c.port}/${c.db}?charset=utf8mb4
`;
    },
  },
  {
    id: 'conn-mongodb',
    group: 'Database connections',
    name: 'MongoDB connection strings',
    file: 'mongodb.txt',
    lang: 'text',
    about: 'A standard connection string, an Atlas-style SRV one and the mongosh command.',
    fields: ['dbhost', 'dbport', 'dbname', 'dbuser', 'dbpassword', 'dbssl'],
    render: (v) => {
      const c = connection(v, 27017);
      return `# Standard
mongodb://${c.auth}@${c.host}:${c.port}/${c.db}?authSource=admin${yes(v, 'dbssl') ? '&tls=true' : ''}

# DNS seed list (MongoDB Atlas and other clusters; no port, TLS is on)
mongodb+srv://${c.auth}@${c.host}/${c.db}?retryWrites=true&w=majority

# Shell
mongosh "mongodb://${c.host}:${c.port}/${c.db}" --username ${c.rawUser} --authenticationDatabase admin${yes(v, 'dbssl') ? ' --tls' : ''}
`;
    },
  },
  {
    id: 'conn-redis',
    group: 'Database connections',
    name: 'Redis connection strings',
    file: 'redis.txt',
    lang: 'text',
    about: 'Redis URLs with a password or an ACL user, over plain TCP or TLS, and the redis-cli command.',
    fields: ['dbhost', 'dbport', 'dbuser', 'dbpassword', 'dbssl'],
    render: (v) => {
      const c = connection(v, 6379);
      const scheme = yes(v, 'dbssl') ? 'rediss' : 'redis';
      return `# Password only (the default user)
${scheme}://:${c.password}@${c.host}:${c.port}/0

# ACL user and password (Redis 6 and later)
${scheme}://${c.auth}@${c.host}:${c.port}/0

# Command line (asks for the password)
redis-cli -h ${c.rawHost} -p ${c.port} --user ${c.rawUser} --askpass${yes(v, 'dbssl') ? ' --tls' : ''}
`;
    },
  },
  {
    id: 'conn-sqlserver',
    group: 'Database connections',
    name: 'SQL Server connection strings',
    file: 'sqlserver.txt',
    lang: 'text',
    about: 'The same connection for .NET, JDBC, ODBC, Python and the sqlcmd tool.',
    fields: ['dbhost', 'dbport', 'dbname', 'dbuser', 'dbpassword', 'dbssl'],
    render: (v) => {
      const c = connection(v, 1433);
      const tls = yes(v, 'dbssl');
      return `# .NET (Microsoft.Data.SqlClient)
Server=${c.rawHost},${c.port};Database=${c.rawDb};User Id=${c.rawUser};Password=${c.rawPassword};Encrypt=${tls ? 'True' : 'False'};TrustServerCertificate=${tls ? 'False' : 'True'}

# JDBC
jdbc:sqlserver://${c.rawHost}:${c.port};databaseName=${c.rawDb};user=${c.rawUser};password=${c.rawPassword};encrypt=${tls};trustServerCertificate=${!tls}

# ODBC
Driver={ODBC Driver 18 for SQL Server};Server=tcp:${c.rawHost},${c.port};Database=${c.rawDb};Uid=${c.rawUser};Pwd=${c.rawPassword};Encrypt=${tls ? 'yes' : 'no'}

# Python (SQLAlchemy with pyodbc)
mssql+pyodbc://${c.auth}@${c.host}:${c.port}/${c.db}?driver=ODBC+Driver+18+for+SQL+Server${tls ? '' : '&TrustServerCertificate=yes'}

# Command line
sqlcmd -S ${c.rawHost},${c.port} -d ${c.rawDb} -U ${c.rawUser}${tls ? ' -N' : ' -C'}
`;
    },
  },
];

export const fileOf = (template: ConfigTemplate, v: Values): string => (typeof template.file === 'function' ? template.file(v) : template.file);

export const TEMPLATE_BY_ID: ReadonlyMap<string, ConfigTemplate> = new Map(TEMPLATES.map((t) => [t.id, t]));
