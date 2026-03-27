import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { Mood } from '../../services/astrology.service';

export interface ChatMessage {
  author: string;
  text: string;
  type: 'user' | 'ai' | 'live';
  mood?: Mood;
}

@Component({
  selector: 'app-chat',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent implements AfterViewChecked {
  @Input() messages: ChatMessage[] = [];
  @Output() sendMessage = new EventEmitter<string>();
  @ViewChild('chatContainer') chatContainer?: ElementRef<HTMLDivElement>;
  draft = '';

  ngAfterViewChecked(): void {
    const box = this.chatContainer?.nativeElement;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }

  submitDraft(): void {
    const value = this.draft.trim();
    if (!value) return;
    this.sendMessage.emit(value);
    this.draft = '';
  }
}
