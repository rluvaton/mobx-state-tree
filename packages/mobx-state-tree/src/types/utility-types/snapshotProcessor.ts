import {
    IType,
    IAnyType,
    BaseType,
    isStateTreeNode,
    IValidationContext,
    IValidationResult,
    AnyObjectNode,
    TypeFlags,
    ExtractNodeType,
    assertIsType,
    isType,
    getSnapshot,
    devMode,
    ComplexType
} from "../../internal"

/** @hidden */
declare const $mstNotCustomized: unique symbol

/** @hidden */
// tslint:disable-next-line:class-name
export interface _NotCustomized {
    // only for typings
    readonly [$mstNotCustomized]: undefined
}
/** @hidden */
export type _CustomOrOther<Custom, Other> = Custom extends _NotCustomized ? Other : Custom

class SnapshotProcessor<IT extends IAnyType, CustomC, CustomS> extends BaseType<
    _CustomOrOther<CustomC, IT["CreationType"]>,
    _CustomOrOther<CustomS, IT["SnapshotType"]>,
    IT["TypeWithoutSTN"],
    ExtractNodeType<IT>
> {
    get flags() {
        return this._subtype.flags | TypeFlags.SnapshotProcessor
    }

    constructor(
        private readonly _subtype: IT,
        private readonly _processors: ISnapshotProcessors<
            IT["CreationType"],
            CustomC,
            IT["SnapshotType"],
            CustomS
        >,
        name?: string
    ) {
        super(name || _subtype.name)
    }

    describe() {
        return `snapshotProcessor(${this._subtype.describe()})`
    }

    private preProcessSnapshot(sn: this["C"]): IT["CreationType"] {
        if (this._processors.preProcessor) {
            return this._processors.preProcessor.call(null, sn)
        }
        return sn as any
    }

    private postProcessSnapshot(sn: IT["SnapshotType"]): this["S"] {
        if (this._processors.postProcessor) {
            return this._processors.postProcessor.call(null, sn) as any
        }
        return sn
    }

    private _fixNode(node: this["N"]): void {
        // the node has to use these methods rather than the original type ones
        proxyNodeTypeMethods(node.type, this, "create", "is", "isMatchingSnapshotId")

        const oldGetSnapshot = node.getSnapshot
        node.getSnapshot = () => {
            return this.postProcessSnapshot(oldGetSnapshot.call(node)) as any
        }
    }

    instantiate(
        parent: AnyObjectNode | null,
        subpath: string,
        environment: any,
        initialValue: this["C"] | this["T"]
    ): this["N"] {
        const processedInitialValue = isStateTreeNode(initialValue)
            ? initialValue
            : this.preProcessSnapshot(initialValue)
        const node = this._subtype.instantiate(
            parent,
            subpath,
            environment,
            processedInitialValue
        ) as any
        this._fixNode(node)
        return node
    }

    reconcile(
        current: this["N"],
        newValue: this["C"] | this["T"],
        parent: AnyObjectNode,
        subpath: string
    ): this["N"] {
        const node = this._subtype.reconcile(
            current,
            isStateTreeNode(newValue) ? newValue : this.preProcessSnapshot(newValue),
            parent,
            subpath
        ) as any
        if (node !== current) {
            this._fixNode(node)
        }
        return node
    }

    getSnapshot(node: this["N"], applyPostProcess: boolean = true): this["S"] {
        const sn = this._subtype.getSnapshot(node)
        return applyPostProcess ? this.postProcessSnapshot(sn) : sn
    }

    isValidSnapshot(value: this["C"], context: IValidationContext): IValidationResult {
        const processedSn = this.preProcessSnapshot(value)
        return this._subtype.validate(processedSn, context)
    }

    getSubTypes() {
        return this._subtype
    }

    is(thing: any): thing is any {
        const value = isType(thing)
            ? this._subtype
            : isStateTreeNode(thing)
            ? getSnapshot(thing, false)
            : this.preProcessSnapshot(thing)
        return this._subtype.validate(value, [{ path: "", type: this._subtype }]).length === 0
    }

    isAssignableFrom(type: IAnyType): boolean {
        return this._subtype.isAssignableFrom(type)
    }

    isMatchingSnapshotId(current: this["N"], snapshot: this["C"]): boolean {
        if (!(this._subtype instanceof ComplexType)) {
            return false
        }
        const processedSn = this.preProcessSnapshot(snapshot)
        return ComplexType.prototype.isMatchingSnapshotId.call(this._subtype, current as any, processedSn)
    }
}

function proxyNodeTypeMethods(
    nodeType: any,
    snapshotProcessorType: any,
    ...methods: (keyof SnapshotProcessor<any, any, any>)[]
) {
    for (const method of methods) {
        nodeType[method] = snapshotProcessorType[method].bind(snapshotProcessorType)
    }
}

// public API

/**
 * A type that has its snapshots processed.
 */
export interface ISnapshotProcessor<IT extends IAnyType, CustomC, CustomS>
    extends IType<
        _CustomOrOther<CustomC, IT["CreationType"]>,
        _CustomOrOther<CustomS, IT["SnapshotType"]>,
        IT["TypeWithoutSTN"]
    > {}

/**
 * Snapshot processors.
 */
export interface ISnapshotProcessors<C, CustomC, S, CustomS> {
    /**
     * Function that transforms an input snapshot.
     */
    preProcessor?(snapshot: CustomC): C
    /**
     * Function that transforms an output snapshot.
     * @param snapshot
     */
    postProcessor?(snapshot: S): CustomS
}

/**
 * `types.snapshotProcessor` - Runs a pre/post snapshot processor before/after serializing a given type.
 *
 * Example:
 * ```ts
 * const Todo1 = types.model({ text: types.string })
 * // in the backend the text type must be null when empty
 * interface BackendTodo {
 *     text: string | null
 * }
 * const Todo2 = types.snapshotProcessor(Todo1, {
 *     // from snapshot to instance
 *     preProcessor(sn: BackendTodo) {
 *         return {
 *             text: sn.text || "";
 *         }
 *     },
 *     // from instance to snapshot
 *     postProcessor(sn): BackendTodo {
 *         return {
 *             text: !sn.text ? null : sn.text
 *         }
 *     }
 * })
 * ```
 *
 * @param type Type to run the processors over.
 * @param processors Processors to run.
 * @param name Type name, or undefined to inherit the inner type one.
 * @returns
 */
export function snapshotProcessor<
    IT extends IAnyType,
    CustomC = _NotCustomized,
    CustomS = _NotCustomized
>(
    type: IT,
    processors: ISnapshotProcessors<IT["CreationType"], CustomC, IT["SnapshotType"], CustomS>,
    name?: string
): ISnapshotProcessor<IT, CustomC, CustomS> {
    assertIsType(type, 1)
    if (devMode()) {
        if (processors.postProcessor && typeof processors.postProcessor !== "function") {
            // istanbul ignore next
            throw fail("postSnapshotProcessor must be a function")
        }
        if (processors.preProcessor && typeof processors.preProcessor !== "function") {
            // istanbul ignore next
            throw fail("preSnapshotProcessor must be a function")
        }
    }

    return new SnapshotProcessor(type, processors, name)
}
