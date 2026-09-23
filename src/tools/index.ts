export * from "./defs.js";
import type { ToolDefinition } from "./defs.js";

import { accountTools } from "./account.js";
import { appsTools } from "./apps.js";
import { billingTools } from "./billing.js";
import { databasesTools } from "./databases.js";
import { deploysTools } from "./deploys.js";
import { docsTools } from "./docs.js";
import { envsTools } from "./envs.js";
import { filesTools } from "./files.js";
import { networkTools } from "./network.js";
import { resourceOrganizationTools } from "./resource-organization.js";
import { snapshotsTools } from "./snapshots.js";
import { workspacesTools } from "./workspaces.js";

export const tools: ToolDefinition[] = [
	...docsTools,
	...appsTools,
	...deploysTools,
	...envsTools,
	...filesTools,
	...networkTools,
	...databasesTools,
	...snapshotsTools,
	...accountTools,
	...resourceOrganizationTools,
	...workspacesTools,
	...billingTools,
];
