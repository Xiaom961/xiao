declare module '@moeru/three-mmd' {
  export class MMDLoader {
    constructor(manager?: any)
    load(
      url: string,
      onLoad: (mmd: any) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void
    ): void
    // Add other methods if needed, but MMDLoader is the main one used.
  }
}
