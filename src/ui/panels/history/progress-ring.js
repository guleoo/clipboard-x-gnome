import Cairo from 'cairo';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const ProgressRing = GObject.registerClass(
class ProgressRing extends St.DrawingArea {
  _init(progress = 0) {
    super._init({
      style_class: 'clipboard-x-progress-ring',
      width: 18,
      height: 18,
    });
    this._progress = progress;
    this.connect('repaint', area => this._repaint(area));
  }

  set progress(value) {
    this._progress = Math.max(0, Math.min(1, Number(value) || 0));
    this.queue_repaint();
  }

  _repaint(area) {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const color = area.get_theme_node().get_foreground_color();
    const red = color.red / 255;
    const green = color.green / 255;
    const blue = color.blue / 255;
    const radius = Math.max(1, Math.min(width, height) / 2 - 2);
    const centerX = width / 2;
    const centerY = height / 2;
    context.setLineWidth(2);
    context.setLineCap(Cairo.LineCap.ROUND);
    context.setSourceRGBA(red, green, blue, 0.22);
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    context.setSourceRGBA(red, green, blue, 1);
    context.arc(
      centerX,
      centerY,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * this._progress,
    );
    context.stroke();
    context.$dispose();
  }
});
