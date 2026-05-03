import { IScriptSnapshot } from "typescript";

export class StringSnapshot implements IScriptSnapshot {
  constructor(private readonly text: string) { }

  public getText(start: number, end: number): string {
    return this.text.slice(start, end);
  }

  public getLength(): number {
    return this.text.length;
  }

  public getChangeRange(_oldSnapshot: IScriptSnapshot): undefined {
    return void 0;
  }
}
