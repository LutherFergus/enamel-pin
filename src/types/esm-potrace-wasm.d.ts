declare module 'esm-potrace-wasm' {
  export function init(): Promise<void>
  export function potrace(
    imageBitmapSource: ImageBitmapSource,
    options?: {
      turdsize?: number
      turnpolicy?: number
      alphamax?: number
      opticurve?: number
      opttolerance?: number
      pathonly?: boolean
      extractcolors?: boolean
      posterizelevel?: number
      posterizationalgorithm?: number
    },
  ): Promise<string | string[]>
}
