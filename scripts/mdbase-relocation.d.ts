import type { TypeDefinition } from '../types/loader.js';
import type { MdbaseSettings } from '../config/loader.js';
export declare function moveRecordNoClobber(root: string, from: string, to: string, expectedHash: string): Promise<void>;
export interface RenameRecord {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  types: string[];
}
export interface RenameChange extends RenameRecord {
  destination: string;
  references: Array<{ location: string; before: string; after: string }>;
}
export declare function planRecordRename(input: {
  records: RenameRecord[];
  types: Map<string, TypeDefinition>;
  settings: MdbaseSettings;
  from: string;
  to: string;
}): { changes: RenameChange[]; warnings: Array<{ path: string; message: string }> };
