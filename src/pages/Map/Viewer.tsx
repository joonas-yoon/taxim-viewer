/* global kakao */

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  CSSProperties,
} from "react"

import Dot from "../../components/Dot"
import Aside from "../../components/Aside"

import LocalTaxiIcon from "@mui/icons-material/LocalTaxi"
import HailIcon from "@mui/icons-material/Hail"
import KeyboardDoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown"
import { Divider, Stack, Typography } from "@mui/joy"
import MuiTooltip from "@mui/joy/Tooltip"

import { CustomOverlayMap, useMap } from "react-kakao-maps-sdk"

import {
  useStatusState,
  StatusState,
  LogFullType,
} from "../../providers/StatusProvider"
import ViewerButtons from "./Controls/ViewerButtons"
import { humanizeDate } from "../../helpers/stringFormat"
import { randomDarkColor } from "../../helpers/colors"
import styled from "styled-components"
import Timeline from "./Timeline"
import { useDynamicFetch } from "../../hooks"

const MarkerType = {
  NONE: -1,
  VEHICLE: 0,
  PERSON_PICK: 1,
  PERSON_DROP: 2,
}

type MarkerPosition = {
  key: string | null
  color?: string
  size: number
  lat: number
  lng: number
  type: number
}

interface ColorName {
  [key: string]: string
}

type VehicleState = {
  name: string
  lat: number
  lng: number
  allocated_id: number | null
}

type TaskType = {
  id: number
  drop_lat: number
  drop_lng: number
  pick_lat: number
  pick_lng: number
  status: number
  time: number
}

const LogIcon = ({
  color,
  style,
  children,
  tooltip = null,
  onClick,
}: any): React.ReactElement => {
  const [isHover, setHover] = useState<boolean>(false)
  return (
    <div
      style={{
        backgroundColor: color || "black",
        display: "flex",
        justifyItems: "center",
        alignItems: "center",
        width: "32px",
        height: "32px",
        borderRadius: "6rem",
        ...style,
      }}
      onMouseOver={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick || null}
    >
      <>{children}</>
      <>{tooltip != null && isHover && tooltip}</>
    </div>
  )
}

const VehicleLogInfoStyled = styled.div`
  width: calc(100% - 12px);
  position: relative;
  box-sizing: border-box;
  padding: 0 6px;
  display: flex;
  align-items: center;
`

const RoadLineStyled = styled.div`
  position: absolute;
  width: 100%;
  height: 3px;
  background-color: #efefef;
  border-radius: 1em;
  z-index: 0;
`

const VehicleIconTooltipStyled = styled.div`
  position: absolute;
  bottom: calc(-32px / 2 - -8px);
  font-size: 12px;
  left: calc(32px / 2);
  width: fit-content;
  white-space: nowrap;
  word-break: keep-all;
  background: ${({ color }: any) => color};
  color: white;
  border-radius: 3px;
  padding: 2px 6px;
  box-sizing: border-box;
  min-width: 32px;
  transform: translateX(-50%);
  text-align: center;
  box-shadow: 0 0 3px rgba(128, 128, 128, 0.2);
`

type DisplayIconProps = {
  type: number
  style?: CSSProperties
}

const Icon = ({ type, style = {} }: DisplayIconProps): any => {
  const iconStyle = {
    fill: "white",
    marginTop: "-1px",
    width: "75%",
    ...style,
  }
  if (type == MarkerType.NONE) {
    return <></>
  } else if (type == MarkerType.VEHICLE) {
    return <LocalTaxiIcon style={iconStyle} />
  } else if (type == MarkerType.PERSON_PICK) {
    return <HailIcon style={iconStyle} />
  } else if (type == MarkerType.PERSON_DROP) {
    return <KeyboardDoubleArrowDownIcon style={iconStyle} />
  }
}

const LogInfoStyled = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  padding: 0.5rem 0;
`

const get_slope_weight = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number
) => {
  const lx = Math.abs(x2 - x1)
  const ly = Math.abs(y2 - y1)
  const dx = cx - x1
  const dy = cy - y1
  const r = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(lx * lx + ly * ly)
  return Math.max(0.0, Math.min(r * 100.0, 100.0))
}

const ViewerBottomFixedWrapperStyled = styled.div<{ expand: boolean }>`
  position: fixed;
  width: 100%;
  bottom: 0;
  left: 0;
  background: white;
  height: 300px;
  transform: ${({ expand }: any) =>
    expand ? "translateY(0px)" : "translateY(300px)"};
  transition: transform 300ms ease-in-out;
  box-shadow: 0 -3px 10px rgba(0, 0, 0, 0.2);
`

const ViewerButtonsClearStyled = styled.div`
  position: relative;
  width: 100%;
`

const TimelineWrapperStyled = styled.div`
  position: absolute;
  overflow: auto;
  width: 100%;
  height: 100%;
  bottom: 0;
`

const SERVER_HOST = process.env.REACT_APP_SERVER_HOST as string

const INITIAL_DATE = new Date("2020-08-29 10:15")
const VEHICLES = 10
const TASKS = 130
const JUMP_MINS = 10

const parseDate = (t: Date) => ({
  year: t.getFullYear(),
  month: t.getMonth() + 1,
  day: t.getDate(),
  hour: t.getHours(),
  minute: t.getMinutes(),
  second: t.getSeconds(),
})

const Viewer = (): React.ReactElement => {
  const [markerPositions, setMarkerPositions] = useState<Array<MarkerPosition>>(
    []
  )
  const [status, setStatus] = useStatusState()
  const [level, setLevel] = useState<number>(3)
  const [runable, setRunable] = useState<boolean>(false)
  const [running, setRunning] = useState<boolean>(false)
  const [speed, setSpeed] = useState<number>(1.0)
  const [progressMax, setProgressMax] = useState<number>(0)
  const [progress, setProgress] = useState<number>(0)
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0)
  const [allColors, setColors] = useState<ColorName>({})
  const [log, setLog] = useState<LogFullType | null>()
  const [vehiclesState, setVehiclesState] = useState<Map<string, VehicleState>>(
    new Map()
  )
  const [responseLog, requestLog] = useDynamicFetch()
  const [displayTime, setDisplayTime] = useState<Date>(INITIAL_DATE)

  useEffect(() => {
    const timeShifted = new Date(
      INITIAL_DATE.getTime() + elapsedMinutes * 60 * 1000
    )
    console.log("elapsed", elapsedMinutes)
    console.log("time", timeShifted)
    setDisplayTime(timeShifted)
    const { year, month, day, hour, minute } = parseDate(timeShifted)
    const url = `${SERVER_HOST}/log/${year}/${month}/${day}/${hour}/${minute}?vehicles=${VEHICLES}&tasks=${TASKS}`
    requestLog(url)
  }, [elapsedMinutes])

  useEffect(() => {
    const { data, loading, error } = responseLog
    console.log("log fetched", data)
    setLog(data as LogFullType)
  }, [responseLog.data])

  useEffect(() => {
    const { log: logFull } = status as StatusState
    setRunable(log !== null)
    setLog(logFull)
  }, [status])

  const map = useMap()

  useEffect(() => {
    setLevel(map.getLevel())
  }, [map])

  useEffect(() => {
    map.setLevel(level)
  }, [map, level])

  const display = useCallback(
    (t: Date) => {
      if (!log) return

      const { time, vehicles, tasks } = log

      const vMarkers: Array<MarkerPosition> = Array.from(vehicles || []).map(
        ({ name, lat, lng }: any) => ({
          key: name,
          color: allColors[name],
          size: 5,
          lat,
          lng,
          type: MarkerType.VEHICLE,
        })
      )

      const tMarkers: Array<MarkerPosition> = Array.from(tasks || [])
        .map(
          ({
            id,
            pick_lat,
            pick_lng,
            drop_lat,
            drop_lng,
            status,
          }: any): any[] => [
            0 <= status && status <= 5
              ? {
                  key: `task-${id}-pick`,
                  color: allColors[id],
                  size: 4,
                  lat: pick_lat,
                  lng: pick_lng,
                  type: MarkerType.PERSON_PICK,
                }
              : null,
            {
              key: `task-${id}-drop`,
              color: allColors[id],
              size: 4,
              lat: drop_lat,
              lng: drop_lng,
              type: MarkerType.PERSON_DROP,
            },
          ]
        )
        .flat()
        .filter((value) => value !== null)

      setMarkerPositions([...vMarkers, ...tMarkers])
      setVehiclesState((prev: Map<string, VehicleState>) => {
        const newState = new Map(prev)
        for (const vehicle of Array.from(vehicles || [])) {
          const { name } = vehicle as VehicleState
          newState.set(name, vehicle as VehicleState)
        }
        return newState
      })
    },
    [log, allColors]
  )

  useEffect(() => {
    if (!log) return
    setVehiclesState((prev: Map<string, VehicleState>) => {
      const nameCollected: string[] = Array.from(
        new Set<string>(log.vehicles.map((v: any): string => v.name || ""))
      )

      const newMap = new Map(prev)
      for (const name of nameCollected) {
        // add empty values having name only
        newMap.set(name, {
          name,
          lat: -1,
          lng: -1,
          allocated_id: null,
        } as VehicleState)
      }
      return newMap
    })
  }, [log])

  useEffect(() => {
    if (!running) return

    // 1 frame contains 60 secs
    const DEFAULT_TIMESTEP = 60 * 1000
    // 1 frame / 1000 ms
    const interval = DEFAULT_TIMESTEP / 60 / (speed || 1.0)
    console.log("info", interval, running, speed)

    const timer = setTimeout(() => {
      setElapsedMinutes((prev) => prev + JUMP_MINS)
    }, interval)

    return () => {
      clearTimeout(timer)
    }
  }, [running, speed, elapsedMinutes])

  const fitMapBound = useCallback(
    (nodes: Array<{ lat: number; lng: number }>) => {
      if (nodes.length < 1) return
      const bounds = new kakao.maps.LatLngBounds()
      nodes.forEach(({ lat, lng }) => {
        bounds.extend(new kakao.maps.LatLng(lat, lng))
      })
      map.setBounds(bounds)
    },
    [map]
  )

  useEffect(() => {
    if (!log) return

    const { vehicles, tasks } = log

    const positions = vehicles
      .map(({ lat, lng }: any) => ({ lat, lng }))
      .concat(
        ...tasks.map(({ pick_lat, pick_lng, drop_lat, drop_lng }: TaskType) => [
          {
            lat: pick_lat,
            lng: pick_lng,
          },
          {
            lat: drop_lat,
            lng: drop_lng,
          },
        ])
      )
      .flat()

    setProgressMax(1000)
    fitMapBound(positions)
  }, [log, fitMapBound])

  useEffect(() => {
    if (!log) return

    const { vehicles, tasks } = log

    // collect and create pairs of name and color
    const nameKeyValueMap: ColorName = [
      ...Array.from(
        new Set<string>(
          vehicles
            .map(({ name }: any) => `${name}`)
            .concat(tasks.map(({ id }: any) => `${id}`))
            .flat()
        )
      ),
    ]
      .map((name: string) => ({
        [name]: randomDarkColor(),
      }))
      .reduce(
        (
          previousValue: { [x: string]: string },
          currentValue: { [x: string]: string }
        ) => ({
          ...previousValue,
          ...currentValue,
        }),
        {}
      )

    setColors(nameKeyValueMap)
  }, [log])

  const focusTo = useCallback(
    ({ lat, lng }: any) => {
      map.panTo(new kakao.maps.LatLng(lat, lng))
    },
    [map]
  )

  type LogItemProps = {
    vehicle: VehicleState
    tasks: TaskType[]
    colors: ColorName
  }

  const LogItemVehicleWithTask = ({ vehicle, tasks, colors }: LogItemProps) => {
    const { name: vehicle_id, lat, lng, allocated_id } = vehicle

    const vehicleTooltip = (
      <VehicleIconTooltipStyled color={colors[vehicle_id]}>
        {vehicle_id}
      </VehicleIconTooltipStyled>
    )

    if (tasks.length < 1) {
      const IconEmptyStyle = {
        backgroundColor: "transparent",
        borderWidth: "1px",
        borderColor: "gray",
        borderStyle: "dashed",
      }
      return (
        <>
          <LogInfoStyled className="pairs" key={`log-info-${vehicle_id}`}>
            <LogIcon
              color={"transparent"}
              style={{
                justifySelf: "flex-start",
                ...IconEmptyStyle,
              }}
            />
            <VehicleLogInfoStyled>
              <RoadLineStyled
                style={{
                  borderTop: `dashed 2px ${colors[vehicle_id]}`,
                  height: "auto",
                  background: "transparent",
                  borderRadius: 0,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  width: "calc(100% - 32px)",
                  top: 0,
                }}
              >
                <LogIcon
                  key={`logicon-${vehicle_id}`}
                  color={colors[vehicle_id]}
                  style={{
                    position: "absolute",
                    left: "50%",
                    transition: "all 300ms ease",
                    zIndex: 1,
                    backgroundColor: "white",
                    borderWidth: "1px",
                    borderColor: colors[vehicle_id],
                    borderStyle: "dashed",
                  }}
                  tooltip={vehicleTooltip}
                >
                  <Icon
                    type={MarkerType.VEHICLE}
                    style={{
                      margin: "0 auto",
                      fill: colors[vehicle_id],
                    }}
                  />
                </LogIcon>
              </div>
            </VehicleLogInfoStyled>
            <LogIcon
              color={"transparent"}
              style={{
                justifySelf: "flex-end",
                ...IconEmptyStyle,
              }}
            />
          </LogInfoStyled>
        </>
      )
    }

    const task = tasks[0]
    const {
      id: task_id,
      status,
      pick_lat,
      pick_lng,
      drop_lat,
      drop_lng,
    }: TaskType = task as TaskType

    const isPicked = status > 5
    const isDroped = status > 6

    const IconReadyStyle = {
      backgroundColor: "transparent",
      borderWidth: "1px",
      borderColor: colors[vehicle_id],
      borderStyle: "dashed",
    }

    const IconNotReadyStyle = {
      borderWidth: "1px",
      borderColor: "transparent",
      borderStyle: "solid",
    }

    const IconReadyInnerStyle = {
      fill: colors[vehicle_id],
    }

    return (
      <LogInfoStyled className="pairs" key={`log-info-${vehicle_id}`}>
        <LogIcon
          color={status <= 5 ? "transparent" : colors[vehicle_id]}
          style={{
            justifySelf: "flex-start",
            cursor: "pointer",
            ...(isPicked ? IconNotReadyStyle : IconReadyStyle),
          }}
          onClick={() => {
            focusTo({
              lat: pick_lat,
              lng: pick_lng,
            })
          }}
        >
          <Icon
            type={MarkerType.PERSON_PICK}
            style={{
              margin: "0 auto",
              ...(isPicked ? {} : IconReadyInnerStyle),
            }}
          />
        </LogIcon>
        <VehicleLogInfoStyled>
          <RoadLineStyled
            style={isPicked ? { backgroundColor: colors[vehicle_id] } : {}}
          />
          <div
            style={{
              position: "absolute",
              width: "calc(100% - 32px)",
              top: 0,
            }}
          >
            <LogIcon
              key={`logicon-${vehicle_id}`}
              color={colors[vehicle_id]}
              style={{
                position: "absolute",
                left: `${get_slope_weight(
                  pick_lat,
                  pick_lng,
                  drop_lat,
                  drop_lng,
                  lat,
                  lng
                )}%`,
                transition: "all 300ms ease",
                cursor: "pointer",
                zIndex: 1,
              }}
              tooltip={vehicleTooltip}
              onClick={() => {
                focusTo({
                  lat,
                  lng,
                })
              }}
            >
              <Icon
                type={MarkerType.VEHICLE}
                style={{
                  margin: "0 auto",
                }}
              />
            </LogIcon>
          </div>
        </VehicleLogInfoStyled>
        <LogIcon
          color={colors[vehicle_id]}
          style={{
            justifySelf: "flex-end",
            cursor: "pointer",
            ...(isDroped ? IconNotReadyStyle : IconReadyStyle),
          }}
          onClick={() => {
            focusTo({
              lat: drop_lat,
              lng: drop_lng,
            })
          }}
        >
          <Icon
            type={MarkerType.PERSON_DROP}
            style={{
              margin: "0 auto",
              ...(isDroped ? {} : IconReadyInnerStyle),
            }}
          />
        </LogIcon>
      </LogInfoStyled>
    )
  }

  const LogInfo = useCallback(
    ({ time, vehicles, tasks, colors }: any) => {
      return (
        <>
          {Array.from(vehicles.values())
            .map((value) => value as VehicleState)
            .map((thisVehicle: VehicleState) => {
              const { name, lat, lng, allocated_id } = thisVehicle
              const thisTasks = Array.from(tasks || []).filter(
                ({ id }: any) => id === allocated_id
              )
              return (
                <LogItemVehicleWithTask
                  vehicle={thisVehicle}
                  tasks={thisTasks as TaskType[]}
                  colors={colors}
                />
              )
            })}
        </>
      )
    },
    [focusTo, vehiclesState]
  )

  const StateViewer = useCallback((): React.ReactElement => {
    if (!log) {
      return (
        <center
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            width: "100%",
          }}
        >
          <Typography
            color="neutral"
            fontSize={2}
            sx={{
              translate: "0% -50%",
              textAlign: "center",
            }}
          >
            재생할 정보가 없습니다.
          </Typography>
        </center>
      )
    }
    const { time, tasks } = log
    return (
      <Stack spacing={1}>
        <div key={`log-${time}`}>
          <Divider
            sx={{
              marginTop: "0.5rem",
              marginBottom: "0.25rem",
            }}
          >
            <Typography color="neutral" fontSize={2}>
              {humanizeDate(new Date(time))}
            </Typography>
          </Divider>
          <LogInfo
            time={time}
            vehicles={vehiclesState}
            tasks={tasks}
            colors={allColors}
          />
        </div>
      </Stack>
    )
  }, [log, allColors, vehiclesState])

  const [isExpandTimeline, setExpanedTimeline] = useState<boolean>(true)

  return (
    <>
      {markerPositions.map(
        ({ key, color, size, lat, lng, type }: MarkerPosition) => (
          <CustomOverlayMap
            key={`marker-${key}`}
            position={{
              lat,
              lng,
            }}
            ref={(ref: any) => {
              if (ref == null) return
              const parentNode = ref.cc.parentElement
              parentNode.className = "vehicle-marker"
            }}
          >
            <Dot color={color || "dodgerblue"} size={size / level}>
              <Icon type={type as number} />
            </Dot>
          </CustomOverlayMap>
        )
      )}

      <ViewerBottomFixedWrapperStyled expand={isExpandTimeline}>
        <ViewerButtonsClearStyled>
          <ViewerButtons
            running={running}
            runable={runable}
            progressMax={progressMax}
            progressCurrent={progress}
            speed={speed}
            onSelectSpeed={setSpeed}
            onProgressUpdated={(i: number) =>
              setProgress(elapsedMinutes * JUMP_MINS)
            }
            onClickPlay={() => setRunning(!running)}
            onClickExpand={setExpanedTimeline}
          />
        </ViewerButtonsClearStyled>
        <TimelineWrapperStyled>
          <Timeline time={displayTime} />
        </TimelineWrapperStyled>
      </ViewerBottomFixedWrapperStyled>

      <Aside>
        <StateViewer />
      </Aside>
    </>
  )
}

export default Viewer
