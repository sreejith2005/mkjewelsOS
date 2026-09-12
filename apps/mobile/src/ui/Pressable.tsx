import { useState } from "react";
import {
  Pressable as NativePressable,
  type GestureResponderEvent,
  type PressableProps as NativePressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type PressableProps = Omit<NativePressableProps, "style"> & {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
};

/**
 * React Native's `Pressable` with the pressed state resolved here.
 *
 * NativeWind's JSX runtime wraps `Pressable` and drops a function-form `style`
 * on this React Native version, so a control styled that way lost its
 * background, border, and padding — a primary button became white text on a
 * white screen. Resolving the function ourselves hands NativeWind a plain style
 * value it passes through intact. Same props as the platform component.
 */
export function Pressable({ style, onPressIn, onPressOut, ...rest }: PressableProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <NativePressable
      {...rest}
      onPressIn={(event: GestureResponderEvent) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={typeof style === "function" ? style({ pressed }) : style}
    />
  );
}
