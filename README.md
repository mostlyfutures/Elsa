# Welcome to Elsa.

<div align="center">
	<img
		src="./src/vs/workbench/browser/parts/editor/media/slice_of_void.png"
	 	alt="Void Welcome"
		width="300"
	 	height="300"
	/>
</div>

Elsa is the open-source Cursor alternative.

Use AI agents on your codebase, checkpoint and visualize changes, and bring any model or host locally. Elsa sends messages directly to providers without retaining your data.

This repo contains the full sourcecode for Elsa. If you're new, welcome!

- 🧭 [Website](https://mostlyfutures.org)



## Reference

Elsa is a fork of the [vscode](https://github.com/microsoft/vscode) repository
## Note
Work is temporarily paused on the Elsa IDE (this repo) while we experiment with a few novel AI coding ideas for Elsa. Stay alerted with new releases in our Discord channel.

## How to Run @Elsa/

### Prerequisites
- Node.js (for Void Editor)
- Python (for ACI Backend)

### Running the Void Editor (Primary IDE)

```bash
# Navigate to the main directory
cd /path/to/Elsa

# Install dependencies
npm install

# Development mode with live reload
npm run watch

# Run the Electron app
npm run electron

# For React component development
npm run watchreact
```

### Running the ACI Backend

```bash
# Navigate to ACI backend
cd scafolding/aci/backend

# Set up Python virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start the server
python -m aci.server
```

### Common Development Commands

**Void Editor:**
- `npm run compile` - Full TypeScript compilation
- `npm run build` - Production build
- `npm run test-browser` - Run browser tests
- `npm run eslint` - Run linting

**ACI Backend:**
- `alembic upgrade head` - Database migrations
- `python -m aci.cli --help` - CLI commands help

For detailed development patterns and architecture, see [CLAUDE.md](./CLAUDE.md).

