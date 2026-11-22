// Typen der prozeduralen Avatar-Engine (JavaScript aus AvatarAnimData.swift).
export interface AvatarDef {
  surface: unknown;
  bodyNodes: unknown;
  /** 15 Zahlen: headX, headY, headZ, widthL/R, heightL/R, spacing, posX L/R, posY L/R, angle L/R, perspective. */
  neutral: number[];
}

export interface EngineResult {
  backPaths: string[];
  headPath: string;
  leftPath: string;
  rightPath: string;
  leftVisible: boolean;
  rightVisible: boolean;
  frontPaths: string[];
}

export interface Engine {
  poseFromExpression(e: Record<string, unknown>): unknown;
  renderAvatar(
    pose: unknown,
    surface: unknown,
    blink: number,
    options: { includeWire: boolean; bodyNodes: unknown; eyeOffset: { x: number; y: number } },
  ): EngineResult;
}
