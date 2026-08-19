"""Animation request models shared by MCP-facing type annotations.

The Bridge transports ordinary JSON dictionaries. These TypedDict definitions document
that JSON shape without coupling clients to FairyGUI's internal XML representation.
"""

from __future__ import annotations

from typing import TypeAlias

from typing_extensions import TypedDict


class Point2D(TypedDict, total=False):
    x: float
    y: float


class PathPoint(Point2D, total=False):
    curveType: str
    smooth: bool
    control1: Point2D | None
    control2: Point2D | None
    near: bool


class EncodedPath(TypedDict, total=False):
    encoded: str
    points: list[PathPoint]


PathDefinition: TypeAlias = list[PathPoint] | EncodedPath | str | None


class VectorValue(Point2D, total=False):
    b1: bool
    b2: bool
    percent: bool


class ColorValue(TypedDict, total=False):
    r: float
    g: float
    b: float
    a: float


class AnimationValue(TypedDict, total=False):
    playing: bool
    frame: int
    animationName: str
    skinName: str


class VisibleValue(TypedDict, total=False):
    visible: bool


class SoundValue(TypedDict, total=False):
    soundUrl: str
    volume: float


class NestedTransitionValue(TypedDict, total=False):
    transitionName: str
    playTimes: int
    stopTime: float


class ShakeValue(TypedDict, total=False):
    amplitude: float
    duration: float


class ColorFilterValue(TypedDict, total=False):
    brightness: float
    contrast: float
    saturation: float
    hue: float


class TextValue(TypedDict, total=False):
    text: str


TransitionValue: TypeAlias = (
    float
    | int
    | bool
    | str
    | VectorValue
    | ColorValue
    | AnimationValue
    | VisibleValue
    | SoundValue
    | NestedTransitionValue
    | ShakeValue
    | ColorFilterValue
    | TextValue
)


class TransitionTween(TypedDict, total=False):
    duration: int
    ease: str
    repeat: int
    yoyo: bool
    start: TransitionValue
    end: TransitionValue
    path: PathDefinition
    customEase: PathDefinition


class TransitionItem(TypedDict, total=False):
    targetId: str
    type: str
    frame: int
    label: str
    value: TransitionValue
    tween: TransitionTween | None


class TransitionDefinition(TypedDict, total=False):
    name: str
    frameRate: int
    options: int
    autoPlay: bool
    autoPlayDelay: float
    autoPlayRepeat: int
    playTimes: int
    items: list[TransitionItem]
