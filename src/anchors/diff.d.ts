declare module "diff" {
  export interface ArrayChange<T> {
    count?: number;
    added?: boolean;
    removed?: boolean;
    value: T[];
  }

  export function diffArrays<T>(oldArray: T[], newArray: T[]): ArrayChange<T>[];
  export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
  ): string;
}
