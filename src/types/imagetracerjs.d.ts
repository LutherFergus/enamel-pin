declare module 'imagetracerjs' {
  type TracerPaletteColor = { r: number; g: number; b: number; a: number }

  type TracerOptions = {
    pal?: TracerPaletteColor[]
    colorsampling?: number
    colorquantcycles?: number
    numberofcolors?: number
    layering?: number
    ltres?: number
    qtres?: number
    pathomit?: number
    rightangleenhance?: boolean
    linefilter?: boolean
    strokewidth?: number
    scale?: number
    roundcoords?: number
    viewbox?: boolean
    desc?: boolean
    blurradius?: number
    blurdelta?: number
    lcpr?: number
    qcpr?: number
  }

  type TracerSegment = {
    type: string
    x1: number
    y1: number
    x2: number
    y2: number
    x3?: number
    y3?: number
  }

  type TracerPath = {
    isholepath?: boolean
    segments: TracerSegment[]
    holechildren?: number[]
  }

  type TraceData = {
    layers: TracerPath[][]
    palette: TracerPaletteColor[]
    width: number
    height: number
  }

  type ImageTracerApi = {
    imagedataToSVG: (
      imgd: { width: number; height: number; data: Uint8ClampedArray },
      options?: TracerOptions,
    ) => string
    imagedataToTracedata: (
      imgd: { width: number; height: number; data: Uint8ClampedArray },
      options?: TracerOptions,
    ) => TraceData
  }

  const ImageTracer: ImageTracerApi
  export default ImageTracer
}
