import { SuperComponent } from '../common/src/index';
export default class Title extends SuperComponent {
    externalClasses: string[];
    options: {
        multipleSlots: boolean;
    };
    properties: import("./type").TdTitleProps;
    data: {
        prefix: string;
        classPrefix: string;
        isExpanded: boolean;
    };
    methods: {
        onExpand(): void;
        onCollapse(): void;
    };
}
