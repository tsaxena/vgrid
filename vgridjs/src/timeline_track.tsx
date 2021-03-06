import * as React from "react";
import * as _ from 'lodash';
import {autorun, observable, computed, action} from 'mobx';
import {observer, inject} from 'mobx-react';

import {SpatialType_Bbox} from './spatial/bbox';
import {IntervalSet, NamedIntervalSet, Interval, Bounds} from './interval';
import TimeState from './time_state';
import {DbVideo} from './database';
import {mouse_key_events} from './events';
import {key_dispatch, KeyMode} from './keyboard';
import {Settings} from './settings';
import {BlockLabelState} from './label_state';
import {ActionStack} from './undo';
import {ColorMap} from './color';

let Constants = {
  /** Height in pixels of ticks marking time beneath timeline */
  tick_height: 20,

  /** Number of ticks (evenly spaced) */
  num_ticks: 10,

  /** Navigator height in pixels */
  navigator_height: 10,

  /** Small timeline */
  mini_timeline_height: 2,

  /** Navigator color */
  navigator_color: "gray",

  /** Overview color */
  overview_color: "blue"
}

function time_to_x(t: number, bounds: TimelineBounds, width: number): number {
  return (t - bounds.start) / bounds.span() * width;
}

function x_to_time(x: number, bounds: TimelineBounds, width: number): number {
  return x / width * bounds.span() + bounds.start;
}


/**
 * Annotate a react component with @canvas_component to use.
 * The component should have a render_canvas method. This
 * annotation will then call render_canvas upon an update
 * to the component.
 */
let canvas_component = <C extends object>(Component: C): C =>
  (class WithCanvas extends React.Component<any, {}> {
    component: any
    disposer : any

    constructor(props: any) {
      super(props);
      this.component = React.createRef();
    }

    call_if = (f: (() => void) | undefined) => {
      if (f) {
        f();
      }
    }

    render_canvas () {
      const canvas = this.component.current.canvas_ref.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          this.call_if(this.component.current.render_canvas(canvas, ctx));
        }
      }
    }

    componentDidMount() {
      this.disposer = autorun(() => this.render_canvas());
    }

    componentDidUpdate() {
      this.render_canvas();
    }

    componentWillUnmount() {
      this.disposer();
    }

    render() {
      let _Component = Component as any;
      return < _Component {...this.props} ref={this.component} />;
    }
  }) as any as C

interface TimelineRowProps {
  intervals: IntervalSet
  full_width: number
  row_height: number
  full_duration: number
  bounds: TimelineBounds
  color: string
}

// Single row of the timeline corresponding to one interval set
@canvas_component
class TimelineRow extends React.Component<TimelineRowProps, {}>{
  private canvas_ref : React.RefObject<HTMLCanvasElement>;

  constructor(props : TimelineRowProps) {
    super(props);
    this.canvas_ref = React.createRef();
  }

  render_canvas = (canvas: HTMLCanvasElement, ctx : CanvasRenderingContext2D) => {
    let props : TimelineRowProps = this.props as TimelineRowProps;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.props.color;
    if (this.props.intervals) {
      this.props.intervals.to_list().forEach(intvl => {
        ctx.fillStyle = this.props.color;
        if (intvl.data.spatial_type instanceof SpatialType_Bbox) {
          let bbox_args = (intvl.data.spatial_type as SpatialType_Bbox).args;
          if (bbox_args.color) {
            ctx.fillStyle = bbox_args.color;
          }
        }
        let bounds = intvl.bounds;
        if (bounds.t2 > this.props.bounds.start && bounds.t1 < this.props.bounds.end) {
          let x1 = Math.max((bounds.t1 - this.props.bounds.start) / this.props.bounds.span() * this.props.full_width, 0);
          let width = Math.max(
            ((bounds.t2 - this.props.bounds.start) / this.props.bounds.span() * this.props.full_width) - x1, 1);
          ctx.fillRect(x1, 0, width, this.props.row_height);
        }
      });
    }
  }

  render() {
    return <canvas ref={this.canvas_ref} width={this.props.full_width} height={this.props.row_height} style={{background: "white" }} />
  }
}

class TimelineBounds {
  @observable start: number = 0
  @observable end: number = 0

  span() {
    return this.end - this.start;
  }

  @action.bound
  set_bounds(start: number, end: number) {
    this.start = start;
    this.end = end;
  }
}

interface TimelineNavigatorProps {
  time_state: TimeState,
  timeline_bounds: TimelineBounds,
  timeline_width: number,
  full_duration: number
}

@canvas_component
class TimelineNavigator extends React.Component<TimelineNavigatorProps, {}> {
  private canvas_ref : React.RefObject<HTMLCanvasElement>;
  private disposer : any;

  constructor (props: TimelineNavigatorProps) {
    super(props);
    this.canvas_ref = React.createRef();
  }

  handleChange = (event: any) => {
    if (event.target) {
      let value  = event.target.valueAsNumber;
      let max = parseInt(event.target.max);
      let start = (this.props.full_duration * (value / this.props.timeline_width)) - (this.props.timeline_bounds.span()/2);
      let end = (this.props.full_duration * (value / this.props.timeline_width)) + (this.props.timeline_bounds.span()/2);

      //Make sure that start/end of bounds do not extend past the duration of the video
      if (start < 0) {
        end -= start;
        start = 0;
      }
      else if (end > this.props.full_duration) {
        start -= end - this.props.full_duration;
        end = this.props.full_duration
      }
      this.props.timeline_bounds.set_bounds(start, end);
    }
  }

  render_canvas = (canvas: HTMLCanvasElement, ctx : CanvasRenderingContext2D) => {
    let time = this.props.time_state.time;

    //Draw the navigator bar's current location
    ctx.fillStyle = Constants.navigator_color;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let x = this.props.timeline_bounds.start * (canvas.width / this.props.full_duration);
    let width = this.props.timeline_bounds.span() * (canvas.width / this.props.full_duration);
    ctx.fillRect(x, 0, width, canvas.height);
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    //Draw the current time on the navigator
    ctx.fillStyle = "#84db57";
    ctx.fillRect((time / this.props.full_duration) * this.props.timeline_width, 0, 2, canvas.height);
  }

  render () {
    return <div className = "timeline-navigator" style={{width: this.props.timeline_width, height: Constants.navigator_height}}>
        <canvas className = "timeline-navigator-canvas" ref = {this.canvas_ref} width = {this.props.timeline_width} height={Constants.navigator_height}/>
        <div className = "timeline-navigator-slider" style={{width: this.props.timeline_width}}>
            <input type="range" min="0" max={this.props.timeline_width} onChange={this.handleChange} style = {{width: this.props.timeline_width}} />
        </div>
    </div>;
  }
}

interface TimelineOverviewProps {
  timeline_width: number,
  full_duration: number,
  intervals: NamedIntervalSet[]
}

@canvas_component
class TimelineOverview extends React.Component<TimelineOverviewProps, {}> {
  private canvas_ref : React.RefObject<HTMLCanvasElement>;
  private disposer : any;

  constructor (props: TimelineOverviewProps) {
    super(props);
    this.canvas_ref = React.createRef();
  }

  render_canvas = (canvas: HTMLCanvasElement, ctx : CanvasRenderingContext2D) => {
    ctx.fillStyle = Constants.overview_color;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.props.intervals.forEach((namedIntervalSet, i) => {
      let intervalSet = namedIntervalSet.interval_set;
      intervalSet.to_list().forEach(intvl => {
        let bounds = intvl.bounds;
        let x1 = (bounds.t1 / this.props.full_duration) * this.props.timeline_width;
        let x2 = ((bounds.t2 - bounds.t1) / this.props.full_duration) * this.props.timeline_width;
        ctx.fillRect(x1, 0, x2, canvas.height);
      });
    });
  }

  render () {
    return <canvas className ="timeline-overview-canvas" ref = {this.canvas_ref} width = {this.props.timeline_width} height= {Constants.mini_timeline_height} />;
  }
}

interface TimelineProps {
  intervals: NamedIntervalSet[]
  time_state: TimeState
  timeline_bounds: TimelineBounds
  timeline_width: number
  timeline_height: number
  expand: boolean
  video: DbVideo
  settings?: Settings
  label_state?: BlockLabelState
  action_stack?: ActionStack
  colors?: ColorMap
}

interface DragTimelineState {
  dragging: boolean
  click_x: number
  click_y: number
  click_time: number
  click_start_time: number
  click_end_time: number
}

interface TimelineState {
  shift_held: boolean
  drag_state: DragTimelineState
  new_positive_interval: Interval | null
  new_negative_interval: Interval | null
}

/**
 * Box containing intervals time markers.
 *
 * Supports the ability to shift+click+drag to pan the timeline.
 * Also allows user to create new intervals.
 */
@inject("settings", "label_state", "action_stack", "colors")
@mouse_key_events
@observer
class Timeline extends React.Component<TimelineProps, TimelineState> {
  state: TimelineState = {
    drag_state: {
      dragging: false, click_x: 0, click_y: 0, click_time: 0, click_start_time: 0, click_end_time: 0
    },
    new_positive_interval: null,
    new_negative_interval: null,
    shift_held: false
  }
  private old_time: number = this.props.time_state.time;

  create_interval = () => {
    let settings = this.props.settings!;
    if ((!this.state.shift_held && !this.state.new_positive_interval) ||
        (this.state.shift_held && !this.state.new_negative_interval)) {
      let time = this.props.time_state.time;
      this.old_time = time;
      let intvls = !this.state.shift_held ?
        this.props.label_state!.new_positive_intervals :
        this.props.label_state!.new_negative_intervals;

      let interval_type = !this.state.shift_held ? "positive" : "negative";
      let new_interval_color = !this.state.shift_held ?
        settings.positive_color : settings.negative_color;
      let new_interval = new Interval(
        new Bounds(time), {spatial_type: new SpatialType_Bbox({color: new_interval_color}), metadata: {}});

      this.props.action_stack!.push({
        name: "add " + interval_type + " time interval",
        do_: () => { intvls.add(new_interval); },
        undo: () => { intvls.remove(new_interval); }
      });

      if (!this.state.shift_held) {
        this.setState({ new_positive_interval: new_interval });
      } else {
        this.setState({ new_negative_interval: new_interval });
      }
    } else {
      if (!this.state.shift_held) {
        this.setState({ new_positive_interval: null });
      } else {
        this.setState({ new_negative_interval: null });
      }
    }
  }

  key_bindings = {
    [KeyMode.Standalone]: {
      'i': this.create_interval
    },
    [KeyMode.Jupyter]: {
      'i': this.create_interval
    }
  }


  onKeyDown = (char: string, x: number, y: number) => {
    if (char == 'Shift') {
      this.setState({shift_held: true});
    }
  }

  onKeyUp = (char: string, x: number, y: number) => {
    if (char == 'Shift') {
      this.setState({shift_held: false});
    }

    key_dispatch(this.props.settings!, this.key_bindings, char);
  }

  onMouseLeave = (x: number, y: number) => {
    // Make sure to reset all state so we don't get into a weird situation on re-entering the timeline
    this.state.drag_state.dragging = false;
    this.setState({shift_held: false});
  }

  onMouseDown = (x: number, y: number) => {
    if (this.state.shift_held) {
      // Record all current state so we can compute deltas relative to state at initial click
      let click_time = x_to_time(x, this.props.timeline_bounds, this.props.timeline_width);
      this.setState({
        drag_state: {
          dragging: true,
          click_x: x,
          click_y: y,
          click_time: click_time,
          click_start_time: this.props.timeline_bounds.start,
          click_end_time: this.props.timeline_bounds.end
        }
      });
    }
  }

  onMouseMove = (x: number, y: number) => {
    let drag = this.state.drag_state;
    if (drag.dragging) {
      // Compute new timeline state relative to initial click
      let diff_x = x - drag.click_x;
      let delta = diff_x / this.props.timeline_width * (this.props.timeline_bounds.end - this.props.timeline_bounds.start);
      let duration = this.props.video.num_frames / this.props.video.fps;
      let new_start = drag.click_start_time - delta;
      let new_end = drag.click_end_time - delta;
      if (0 <= new_start && new_end < duration) {
        this.props.timeline_bounds.set_bounds(new_start, new_end);
      }
    }
  }

  onMouseUp = (x: number, y: number) => {
    if (!this.state.drag_state.dragging) {
      // If the user just normally clicks on the timeline, shift the cursor to that point
      this.props.time_state.time = x_to_time(
        x, this.props.timeline_bounds, this.props.timeline_width);
    } else {
      this.state.drag_state.dragging = false;
      this.forceUpdate();
    }
  }

  componentDidUpdate() {
    let time = this.props.time_state.time
    if (time != this.old_time) {
      let old_span = this.props.timeline_bounds.span();
      if (time > this.props.timeline_bounds.end) {
        this.props.timeline_bounds.set_bounds(time - old_span, time);
      }
      else if (time < this.props.timeline_bounds.start) {
        this.props.timeline_bounds.set_bounds(time, time + old_span);
      }
      this.old_time = time;
    }

    if (this.state.new_positive_interval) {
      let new_positive_interval = this.state.new_positive_interval;
      if (time > new_positive_interval.bounds.t1 && time != new_positive_interval.bounds.t2) {
        console.log(`Setting new_positive_interval bounds to ${time}`);
        new_positive_interval.bounds.t2 = time;

        // Cycling the interval in/out of the set causes mobx to trigger updates to any renderers of the intervals.
        // We do this in lieu of observing interval fields since that gets too expensive with 10k+ intervals.
        let new_positive_intervals = this.props.label_state!.new_positive_intervals;
        new_positive_intervals.remove(new_positive_interval);
        new_positive_intervals.add(new_positive_interval);
      }
    }
    if (this.state.new_negative_interval) {
      let new_negative_interval = this.state.new_negative_interval;
      if (time > new_negative_interval.bounds.t1 && time != new_negative_interval.bounds.t2) {
        console.log(`Setting new_negative_interval bounds to ${time}`);
        new_negative_interval.bounds.t2 = time;

        // Cycling the interval in/out of the set causes mobx to trigger updates to any renderers of the intervals.
        // We do this in lieu of observing interval fields since that gets too expensive with 10k+ intervals.
        let new_negative_intervals = this.props.label_state!.new_negative_intervals;
        new_negative_intervals.remove(new_negative_interval);
        new_negative_intervals.add(new_negative_interval);
      }
    }
  }

  render() {
    let keys = this.props.intervals.map(({name}) => name);

    let new_positive_intervals = this.props.label_state!.new_positive_intervals;
    let new_negative_intervals = this.props.label_state!.new_negative_intervals;
    if (new_positive_intervals.length() > 0 || new_negative_intervals.length() > 0) {
      keys.push('__new_intervals');
    }

    let row_height = Math.floor(this.props.timeline_height / keys.length);
    let time = this.props.time_state.time;

    let video_span = this.props.video.num_frames / this.props.video.fps;
    let window_span = this.props.timeline_bounds.span();
    let full_width = this.props.timeline_width;
    let box_style = {width: this.props.timeline_width, height: this.props.timeline_height};

    let keys_to_intervals : { [key: string]: IntervalSet } = {};
    for (let key_idx in keys) {
      let key = keys[key_idx];
      if (key == '__new_intervals') {
        keys_to_intervals[key] = new_positive_intervals.union(new_negative_intervals);
      } else {
        keys_to_intervals[key] = this.props.intervals[key_idx].interval_set;
      }
    }

    return <div className='timeline-box' style={box_style}>
        <div className='timeline-cursor' style={{
          width: this.props.expand ? 4 : 2,
          height: this.props.timeline_height,
          left: time_to_x(time, this.props.timeline_bounds, this.props.timeline_width)
        }} />

        <div className='timeline-window'>
            {keys.map((k, i) =>
              <TimelineRow
                key={k}
                intervals={keys_to_intervals[k]}
                row_height={row_height}
                full_width={full_width}
                full_duration={video_span}
                bounds={this.props.timeline_bounds}
                color={this.props.colors![k]}
              />
            )}
        </div>
    </div>;
  }
}

interface TicksProps {
  timeline_width: number,
  timeline_bounds: TimelineBounds,
  height: number,
  num_ticks: number,
  show_hours: boolean
}

/** Ticks at the bottom of the timeline indicating video time at regular intervals */
@canvas_component
@observer
class Ticks extends React.Component<TicksProps, {}> {
  private canvas_ref : React.RefObject<HTMLCanvasElement>;

  constructor (props: TicksProps) {
    super(props);
    this.canvas_ref = React.createRef();
  }

  render_canvas = (canvas: HTMLCanvasElement, ctx : CanvasRenderingContext2D) => {
    let start = this.props.timeline_bounds.start;
    let end = this.props.timeline_bounds.end;
    let duration = end - start;
    let ticks = _.range(start, end, duration / this.props.num_ticks);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.font = '12px sans-serif';
    ctx.textAlign = "center";

    {ticks.map((tick, i) => {
      let hours = Math.floor(tick / 3600);
      let minutes = Math.floor(60 * (tick / 3600 - hours));
      let seconds = Math.floor(60 * (60 * (tick / 3600 - hours) - minutes));
      let time_str = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      if (this.props.show_hours) {
        time_str = `${hours.toString().padStart(2, '0')}:` + time_str;
      }
      let x = time_to_x(tick, this.props.timeline_bounds, this.props.timeline_width);

      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.props.height / 2);
      ctx.fillText(time_str, x, this.props.height);
    })}
    ctx.stroke();
  }

  render() {
    return <canvas ref = {this.canvas_ref} width = {this.props.timeline_width} height = {this.props.height} />;
  }
}

interface TimelineControlsProps {
  time_state: TimeState
  timeline_bounds: TimelineBounds
  video: DbVideo
  controller_size: number
}

/** Controls for panning and zooming the timeline. */
class TimelineControls extends React.Component<TimelineControlsProps, {}> {
  zoom_in = () => {
    let cur_time = this.props.time_state.time;
    let start = this.props.timeline_bounds.start;
    let end = this.props.timeline_bounds.end;
    let new_start;
    let new_end;
    let new_span = (end - start) / 2;

    if (start <= cur_time && cur_time <= end) {
      // zoom in, centered around current time
      if (cur_time - new_span / 2 > start) {
        // beginning fits
        new_start = cur_time - new_span / 2;
        if (new_start + new_span < end) {
          // both endpoints fit
          new_end = new_start + new_span;
        } else {
          // snap to the end
          new_start = end - new_span;
          new_end = end;
        }
      } else {
        // snap to the beginning
        new_start = start;
        new_end = new_start + new_span;
      }
    } else {
      // zoom in to the middle
      new_start = start + new_span / 4;
      new_end = end - new_span / 4;
    }

    this.props.timeline_bounds.set_bounds(new_start, new_end);
  }

  zoom_out = () => {
    let start = this.props.timeline_bounds.start;
    let end = this.props.timeline_bounds.end;
    let new_start;
    let new_end;

    let new_span = (end - start) * 2;
    let duration = this.props.video.num_frames / this.props.video.fps;

    if (new_span <= duration) {
      if (start - new_span / 4 >= 0) {
        // new beginning will fit
        new_start = start - new_span / 4;
        if (new_start + new_span <= duration) {
          // new end will fit
          new_end = new_start + new_span;
        } else {
          // snap to the end
          new_end = duration;
        }
      } else {
        // snap to the beginning
        new_start = 0;
        new_end = new_span;
      }
    } else {
      new_start = 0;
      new_end = duration;
    }

    this.props.timeline_bounds.set_bounds(new_start, new_end);
  }

  shift_earlier = () => {
    let start = this.props.timeline_bounds.start;
    let end = this.props.timeline_bounds.end;
    if (start > 0) {
      let span = end - start;
      let shift = span / 2;
      if (start - shift > 0) {
        this.props.timeline_bounds.set_bounds(start - shift, end - shift);
      } else {
        this.props.timeline_bounds.set_bounds(0, span);
      }
    }
  }

  shift_later = () => {
    let start = this.props.timeline_bounds.start;
    let end = this.props.timeline_bounds.end;
    let duration = this.props.video.num_frames / this.props.video.fps;

    if (end < duration) {
      let span = end - start;
      let shift = span / 2;

      if (end + shift < duration) {
        this.props.timeline_bounds.set_bounds(start + shift, end + shift);
      } else {
        this.props.timeline_bounds.set_bounds(duration - span, duration);
      }
    }
  }

  shouldComponentUpdate(new_props: TimelineControlsProps, new_state: {}) {
    /* Once the timeline controls are drawn, they should never update.
     * This prevents the buttons from redrawing while the video is playing, causing buttons
     * to miss mouse clicks. */
    return false;
  }

  render() {
    let ControllerButton = (props: {callback: () => void, cls: string}) =>
      (<button type="button" className="btn btn-outline-dark" onClick={props.callback}
               style={{width: this.props.controller_size/2, height: this.props.controller_size/2}}>
          <span className={`oi oi-${props.cls}`} />
      </button>);

    let controls_style = {
      width: this.props.controller_size,
      height: this.props.controller_size
    };

    return <div className='timeline-controls' style={controls_style}>
        <span className="btn-group">
            <ControllerButton callback={this.zoom_in} cls="plus" />
            <ControllerButton callback={this.zoom_out} cls="minus" />
        </span>
        <span className="btn-group">
            <ControllerButton callback={this.shift_earlier} cls="caret-left" />
            <ControllerButton callback={this.shift_later} cls="caret-right" />
        </span>
    </div>;
  }
}

interface TimelineTrackProps {
  intervals: NamedIntervalSet[]
  time_state: TimeState,
  video: DbVideo,
  expand: boolean,
  width: number,
  height: number,
  show_timeline_controls: boolean,
  settings?: Settings
}

/**
 * Component that shows the temporal extent of all intervals within a block.
 * Each set of intervals is drawn in a different row.
 */
@inject("settings")
export default class TimelineTrack extends React.Component<TimelineTrackProps, {}> {
  /**
   * The timeline view shows all intervals between some bounds [t1, t2]. These bounds can
   * be adjusted using timeline controls.
   */
  timeline_bounds: TimelineBounds

  constructor(props: TimelineTrackProps) {
    super(props);

    // Initialize default timeline bounds to [0, video duration].
    this.timeline_bounds = new TimelineBounds();
    this.timeline_bounds.set_bounds(0, props.video.num_frames / props.video.fps);
  }

  render() {
    let settings = this.props.settings!;
    let timeline_width = this.props.width;
    let timeline_height =
      this.props.expand
      ? settings.timeline_height_expanded
      : settings.timeline_height;
    let timeline_color =
      this.props.expand
      ? "gray"
      : "white";
    let full_duration = this.props.video.num_frames / this.props.video.fps;
    let show_hours = full_duration > 60 * 60;

    let controller_size = timeline_height;
    let track_width = this.props.expand ? timeline_width + controller_size : timeline_width;

    return <div className='timeline-track' style={{width: track_width}}>
        {this.props.expand && this.props.show_timeline_controls
        ? [<TimelineNavigator
            time_state={this.props.time_state}
            timeline_bounds={this.timeline_bounds}
            timeline_width={timeline_width}
            full_duration={full_duration} />,

          <TimelineOverview
            timeline_width={timeline_width}
            full_duration={full_duration}
            intervals={this.props.intervals} />]
        : null }

        <div className='timeline-row'>

            <Timeline
              timeline_bounds={this.timeline_bounds}
              timeline_width={timeline_width}
              timeline_height={timeline_height}
              time_state={this.props.time_state}
              intervals={this.props.intervals}
              expand={this.props.expand}
              video={this.props.video} />

            {this.props.expand && this.props.show_timeline_controls
            ? (<TimelineControls
                 timeline_bounds={this.timeline_bounds} video={this.props.video}
                 time_state={this.props.time_state} controller_size={controller_size} />)
            : null }

            <div className='clearfix' />
        </div>

        <div className='timeline-row'>
            {this.props.expand
            ? <Ticks
                timeline_width={timeline_width}
                timeline_bounds={this.timeline_bounds}
                height={Constants.tick_height}
                num_ticks={Constants.num_ticks}
                show_hours={show_hours}/>
            : null}
            <div className='clearfix' />
        </div>
    </div>;
  }
}
