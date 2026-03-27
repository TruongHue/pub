import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-avatar',
  imports: [CommonModule],
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.css'
})
export class AvatarComponent {
  @Input() text = '';
  @Input() mood: 'mysterious' | 'warning' | 'positive' = 'mysterious';
  @Input() speaking = false;
  @Input() loading = false;
}
