import { EventLoopTopology } from "@/components/EventLoopTopology";

const form = L.form;

export default function (
  _m: LuCI.form.Map,
  s: LuCI.form.NamedSection,
  tabId: string,
) {
  const option = s.taboption(
    tabId,
    form.DummyValue,
    "_event_loop_topology",
    _("Event-loop Topology"),
  );
  option.render = () => new EventLoopTopology().render();
}
