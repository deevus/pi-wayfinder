declare module "diff" {
  export interface ArrayChange<T> {
    count?: number;
    added?: boolean;
    removed?: boolean;
    value: T[];
  }

  export interface TextChange {
    count?: number;
    added?: boolean;
    removed?: boolean;
    value: string;
  }

  export function diffArrays<T>(oldArray: T[], newArray: T[]): ArrayChange<T>[];
  export function diffLines(oldStr: string, newStr: string): TextChange[];
}
