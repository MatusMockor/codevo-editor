export interface NativeWindowPort {
  setBackgroundColor(color: string): Promise<void>;
  show(): Promise<void>;
}
