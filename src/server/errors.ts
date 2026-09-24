/**
 * Shared by every "master data" module (parties, items, users, locations, ...). Split out from
 * masters.ts so modules that masters.ts itself imports from (e.g. locations.ts, for the shop an
 * item's opening stock defaults into) can throw it too, without an import cycle back into masters.ts.
 */
export class MasterError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}
