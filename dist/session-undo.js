// Ownership of the previous take survives Clear and failed replacements.
export class SessionUndo {
 constructor(dispose=()=>{}){this.value=null;this.dispose=dispose;}
 remember(value){if(!value)return;const previous=this.value;this.value=value;if(previous&&previous!==value)this.dispose(previous);}
 take(){const value=this.value;this.value=null;return value;}
 clear(){const value=this.take();if(value)this.dispose(value);}
 get available(){return !!this.value;}
}
